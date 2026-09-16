const DEFAULT_MODELS = [
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite'
];
const ATTEMPT_TIMEOUT_MS = 15000;
const SYSTEM_PROMPT = 'You are a Fallout historian with detailed knowledge of all Fallout games and related content. Answer only about Fallout topics. Be helpful, immersive, and stay in character as a wasteland archivist. Keep answers concise unless asked for detail.';

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

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: message.trim() }] }],
    generationConfig: { maxOutputTokens: 2048 }
  });
  let allQuotaErrors = true;

  // Each message starts with the preferred model. Each model gets one attempt.
  for (const model of models) {
    let response;
    let data;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
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
      console.warn('Gemini request failed or timed out:', model);
      continue;
    }

    if (!response.ok) {
      console.warn('Gemini request rejected:', model, response.status);
      if (response.status !== 429) allQuotaErrors = false;
      if ([404, 408, 429, 500, 502, 503, 504].includes(response.status)) continue;

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

    console.info('Gemini response model:', model);
    return res.status(200).json({ reply });
  }

  res.setHeader('Retry-After', '60');
  return res.status(allQuotaErrors ? 429 : 503).json({
    error: allQuotaErrors
      ? 'The archives have reached their current AI quota. Please try again later.'
      : 'The archives are temporarily unavailable. Please try again later.'
  });
}
