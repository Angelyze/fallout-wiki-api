const DEFAULT_MODELS = [
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite'
];
const ATTEMPT_TIMEOUT_MS = 15000;
const SYSTEM_PROMPT = 'You are a Fallout historian with detailed knowledge of all Fallout games and related content. Answer only about Fallout topics. Be helpful, immersive, and stay in character as a wasteland archivist. Answer directly without repeating the question or adding a greeting. Usually use one or two short paragraphs; expand when asked for detail.';

// Best-effort memory for this warm function instance, not a shared quota store.
const modelCooldowns = new Map();
let cooldownApiKey;

function generationConfig(model) {
  const config = { maxOutputTokens: 2048 };
  if (model === 'gemini-flash-latest') config.thinkingConfig = { thinkingLevel: 'LOW' };
  if (model === 'gemini-3.1-flash-lite') config.thinkingConfig = { thinkingLevel: 'MINIMAL' };
  if (model === 'gemini-2.5-flash-lite') config.thinkingConfig = { thinkingBudget: 0 };
  return config;
}

function quotaCooldownMs(response, data) {
  const retryAfter = response.headers.get('retry-after');
  let delayMs = NaN;
  if (retryAfter) {
    delayMs = /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  }
  if (!Number.isFinite(delayMs)) {
    const details = data?.error?.details;
    const retry = Array.isArray(details)
      ? details.find(detail => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') : undefined;
    if (typeof retry?.retryDelay === 'string' && /^\d+(\.\d+)?s$/.test(retry.retryDelay)) {
      delayMs = parseFloat(retry.retryDelay) * 1000;
    }
  }
  return Math.max(1000, Math.min(Number.isFinite(delayMs) ? delayMs : 60000, 300000));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const message = req.body?.message;
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (message.length > 6000) {
    return res.status(400).json({ error: 'Please keep messages under 6,000 characters.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured' });

  // Server configuration only: the browser cannot select arbitrary models.
  const models = process.env.GEMINI_MODELS === undefined
    ? DEFAULT_MODELS
    : [...new Set(process.env.GEMINI_MODELS.split(',').map(model => model.trim()).filter(Boolean))];
  if (!models.length || models.length > 3 || models.some(model => !/^gemini-[a-z0-9.-]+$/.test(model))) {
    console.error('GEMINI_MODELS must contain one to three Gemini model IDs.');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (cooldownApiKey !== apiKey) {
    modelCooldowns.clear();
    cooldownApiKey = apiKey;
  }
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: message.trim() }] }]
  };
  let allQuotaErrors = true;
  const started = Date.now();

  // Prefer the configured order, skipping models still in a failure cooldown.
  for (const model of models) {
    const cooldown = modelCooldowns.get(model);
    if (cooldown?.until > Date.now()) {
      if (cooldown.status !== 429) allQuotaErrors = false;
      continue;
    }
    modelCooldowns.delete(model);
    let response;
    let data;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ ...payload, generationConfig: generationConfig(model) }),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
        }
      );
      // Error responses may be HTML or empty; status still determines fallback.
      try {
        data = await response.json();
      } catch (error) {
        if (response.ok) throw error;
      }
    } catch {
      allQuotaErrors = false;
      modelCooldowns.set(model, { until: Date.now() + 15000, status: 503 });
      console.warn('Gemini request failed or timed out:', model);
      continue;
    }

    if (!response.ok) {
      console.warn('Gemini request rejected:', model, response.status);
      if (response.status !== 429) allQuotaErrors = false;
      if ([404, 408, 429, 500, 502, 503, 504].includes(response.status)) {
        const delayMs = response.status === 429 ? quotaCooldownMs(response, data)
          : response.status === 404 ? 60000 : 15000;
        modelCooldowns.set(model, { until: Date.now() + delayMs, status: response.status });
        continue;
      }

      // Bad credentials or invalid requests will not be fixed by changing models.
      return res.status(502).json({ error: 'The AI service could not process the request. Please contact the site owner.' });
    }

    const candidate = data?.candidates?.[0];
    if (data?.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) {
      return res.status(422).json({ error: 'The AI could not answer this message. Please rephrase your Fallout question.' });
    }
    const reply = candidate?.content?.parts
      ?.filter(part => !part.thought && typeof part.text === 'string')
      .map(part => part.text).join('').trim();
    if (!reply) {
      return res.status(502).json({ error: 'No response from Gemini. Please try again.' });
    }

    const durationMs = Date.now() - started;
    res.setHeader('Server-Timing', `chat;dur=${durationMs}`);
    console.info('Gemini response:', { model, durationMs, thinkingTokens: data.usageMetadata?.thoughtsTokenCount || 0 });
    return res.status(200).json({ reply });
  }

  const nextAttemptMs = Math.min(...models.map(model => modelCooldowns.get(model)?.until || Date.now()));
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((nextAttemptMs - Date.now()) / 1000))));
  return res.status(allQuotaErrors ? 429 : 503).json({
    error: allQuotaErrors
      ? 'The archives have reached their current AI quota. Please try again later.'
      : 'The archives are temporarily unavailable. Please try again later.'
  });
}
