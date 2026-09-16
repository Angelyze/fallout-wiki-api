import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/chat.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;
const originalModels = process.env.GEMINI_MODELS;
let calls;
let keySequence = 0;
beforeEach(() => {
  // A new key also resets warm-instance cooldowns between independent tests.
  process.env.GEMINI_API_KEY = `test-key-${++keySequence}`;
  delete process.env.GEMINI_MODELS;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({ GEMINI_API_KEY: originalKey, GEMINI_MODELS: originalModels })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const success = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
  { text: 'private thought', thought: true }, { text: ' War ' }, { text: 'never changes. ' }
] } }] });
function responses(...items) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.ok(items.length, 'unexpected extra request');
    const next = items.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}
async function request(body = { message: ' Who founded the Brotherhood? ' }, method = 'POST') {
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
  await handler({ method, body }, res);
  return res;
}

test('preferred model succeeds without fallback; prompt and key stay server-side', async () => {
  responses(success());
  const res = await request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { reply: 'War never changes.' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], process.env.GEMINI_API_KEY);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.contents[0].parts[0].text, 'Who founded the Brotherhood?');
  assert.match(payload.systemInstruction.parts[0].text, /Fallout historian/);
  assert.deepEqual(payload.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.match(res.headers['Server-Timing'], /^chat;dur=\d+$/);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('quota failures skip exhausted models until cooldown expires, then restore preference', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  responses(new Response('', { status: 429 }), new Response('', { status: 429 }), success(), success(), success());
  assert.equal((await request()).statusCode, 200);
  assert.equal((await request()).statusCode, 200);
  now += 60001;
  assert.equal((await request()).statusCode, 200);
  assert.deepEqual(calls.map(call => call.url.split('/models/')[1].split(':')[0]), [
    'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-latest'
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body).generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(JSON.parse(calls[2].options.body).generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

for (const status of [404, 408, 500, 502, 503, 504]) {
  test(`fallback on HTTP ${status} even with a non-JSON error body`, async () => {
    responses(new Response('<html>Error</html>', { status }), success());
    assert.equal((await request()).statusCode, 200);
    assert.equal(calls.length, 2);
  });
}
for (const error of [new TypeError('network failed'), new DOMException('timeout', 'TimeoutError')]) {
  test(`fallback on ${error.name}`, async () => {
    responses(error, success());
    assert.equal((await request()).statusCode, 200);
    assert.equal(calls.length, 2);
  });
}
for (const status of [400, 401, 403]) {
  test(`HTTP ${status} stops immediately and does not expose upstream details`, async () => {
    responses(Response.json({ error: { message: 'private diagnostic' } }, { status }));
    const res = await request();
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(res.body.error, /private diagnostic/);
    assert.equal(calls.length, 1);
  });
}
test('all quota failures return 429 with no extra attempts', async () => {
  responses(...[1, 2, 3].map(() => new Response('', { status: 429 })));
  const res = await request();
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '60');
  // A second request on this instance should fail quickly without more API calls.
  assert.equal((await request()).statusCode, 429);
  assert.equal(calls.length, 3);
});
test('mixed exhausted failures return 503', async () => {
  responses(new Response('', { status: 429 }), new Response('', { status: 503 }), new TypeError('offline'));
  assert.equal((await request()).statusCode, 503);
  assert.equal(calls.length, 3);
});
test('safety blocks and empty answers do not trigger model fallback', async () => {
  for (const [data, status] of [
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 422],
    [{ candidates: [{ finishReason: 'SAFETY' }] }, 422],
    [{ candidates: [] }, 502]
  ]) {
    calls = [];
    responses(Response.json(data));
    assert.equal((await request()).statusCode, status);
    assert.equal(calls.length, 1);
  }
});
test('invalid bodies, missing key, and methods make no upstream requests', async () => {
  responses();
  for (const body of [null, {}, { message: 1 }, { message: '   ' }, { message: 'x'.repeat(6001) }]) {
    assert.equal((await request(body)).statusCode, 400);
  }
  assert.equal((await request({}, 'OPTIONS')).statusCode, 200);
  assert.equal((await request({}, 'GET')).statusCode, 405);
  delete process.env.GEMINI_API_KEY;
  assert.equal((await request()).statusCode, 500);
  assert.equal(calls.length, 0);
});
test('model configuration is server-only, ordered, and deduplicated', async () => {
  process.env.GEMINI_MODELS = ' gemini-3.1-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite ';
  responses(new Response('', { status: 429 }), success());
  assert.equal((await request({ message: 'Fallout?', model: 'gemini-pro' })).statusCode, 200);
  assert.match(calls[0].url, /gemini-3.1-flash-lite:/);
  assert.match(calls[1].url, /gemini-2.5-flash-lite:/);
});
test('invalid model configuration fails before making requests', async () => {
  responses();
  for (const value of ['', 'https://example.com', 'gemini-a,gemini-b,gemini-c,gemini-d']) {
    process.env.GEMINI_MODELS = value;
    assert.equal((await request()).statusCode, 500);
  }
  assert.equal(calls.length, 0);
});

test('Google RetryInfo controls when a quota-limited model is retried', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  process.env.GEMINI_MODELS = 'gemini-flash-latest';
  responses(Response.json({ error: { details: [
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '25s' }
  ] } }, { status: 429 }), success());
  const first = await request();
  assert.equal(first.headers['Retry-After'], '25');
  now += 10000;
  const second = await request();
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers['Retry-After'], '15');
  assert.equal(calls.length, 1);
  now += 15001;
  assert.equal((await request()).statusCode, 200);
  assert.equal(calls.length, 2);
});

test('Retry-After header is honored and long delays are capped at five minutes', async t => {
  t.mock.method(Date, 'now', () => 1000000);
  process.env.GEMINI_MODELS = 'gemini-flash-latest';
  responses(new Response('', { status: 429, headers: { 'Retry-After': '3600' } }));
  assert.equal((await request()).headers['Retry-After'], '300');
});

test('network failures get a short cooldown and can recover', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  responses(new TypeError('offline'), success(), success(), success());
  assert.equal((await request()).statusCode, 200);
  assert.equal((await request()).statusCode, 200);
  assert.match(calls[2].url, /gemini-3.1-flash-lite:/);
  now += 15001;
  assert.equal((await request()).statusCode, 200);
  assert.match(calls[3].url, /gemini-flash-latest:/);
});

test('rotating an API key clears cooldowns from the old key', async () => {
  process.env.GEMINI_MODELS = 'gemini-flash-latest';
  responses(new Response('', { status: 429 }), success());
  assert.equal((await request()).statusCode, 429);
  process.env.GEMINI_API_KEY += '-rotated';
  assert.equal((await request()).statusCode, 200);
  assert.equal(calls.length, 2);
});

test('custom models are not sent unverified thinking settings', async () => {
  process.env.GEMINI_MODELS = 'gemini-custom';
  responses(success());
  assert.equal((await request()).statusCode, 200);
  assert.equal(JSON.parse(calls[0].options.body).generationConfig.thinkingConfig, undefined);
});
