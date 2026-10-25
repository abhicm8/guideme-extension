import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { GeminiClient } from '../lib/gemini-client.js';
const config = globalThis.GuideMeAIConfig;
const ok = value => ({ ok: true, status: 200, async json() { return value; } });
const guide = { candidates: [{ content: { parts: [{ thought: true, text: 'Reasoning summary' }, { text: '{"steps":' }, { text: '[]}' }] }, finishReason: 'STOP' }] };
const pair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----\n`;
const credentials = { type: 'service_account', project_id: 'test-project', client_email: 'test@test-project.iam.gserviceaccount.com', private_key: pem };
const vertex = { apiProvider: 'vertex', vertexCredentials: credentials, geminiModel: 'gemini-3.8-flash', geminiThinking: 'HIGH' };

test('Gemini API uses the chosen model, key header, and supported thinking without exposing thoughts', async () => {
  let request;
  const client = new GeminiClient({ fetcher: async (url, options) => { request = { url, ...options }; return ok(guide); } });
  assert.equal(await client.generate({ apiProvider: 'gemini', apiKey: 'example-key', geminiModel: 'gemini-3.6-flash', geminiThinking: 'MINIMAL' }, 'system', 'task'), '{"steps":[]}');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse');
  assert.equal(request.headers['x-goog-api-key'], 'example-key');
  assert.deepEqual(JSON.parse(request.body).generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.equal(request.body.includes('example-key'), false);
});

test('Vertex signs a verifiable scoped JWT and calls the global endpoint with an access token', async () => {
  const calls = [];
  const clock = 1792600000000;
  const client = new GeminiClient({ cryptoProvider: webcrypto, now: () => clock, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return ok(url.endsWith('/token') ? { access_token: 'short-lived-token', expires_in: 3600 } : guide);
  } });
  await client.generate({ ...vertex, vertexCredentials: { ...credentials, token_uri: 'https://untrusted.invalid/token' } }, 'system', 'task');
  const [auth, inference] = calls;
  assert.equal(auth.url, 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(auth.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, payload, signature] = form.get('assertion').split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, credentials.client_email);
  assert.equal(claims.aud, auth.url);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(claims.iat, clock / 1000);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
  assert.equal(inference.url, 'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  assert.equal(inference.headers.Authorization, 'Bearer short-lived-token');
  assert.equal(inference.body.includes('PRIVATE KEY'), false);
  assert.equal(inference.body.includes(credentials.client_email), false);
  assert.deepEqual(JSON.parse(inference.body).generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
});

test('Vertex reuses a token, refreshes near expiry, and uses explicit project and region', async () => {
  let clock = Date.now(), exchanges = 0, target;
  const client = new GeminiClient({ now: () => clock, fetcher: async (url) => {
    if (url.endsWith('/token')) { exchanges++; return ok({ access_token: `token-${exchanges}`, expires_in: 3600 }); }
    target = url; return ok(guide);
  } });
  const settings = { ...vertex, vertexProject: 'another-project', vertexLocation: 'us-central1' };
  await client.generate(settings, '', ''); await client.generate(settings, '', '');
  assert.equal(exchanges, 1);
  assert.match(target, /^https:\/\/us-central1-aiplatform.googleapis.com\/v1\/projects\/another-project\/locations\/us-central1\//);
  clock += 3550000;
  await client.generate(settings, '', '');
  assert.equal(exchanges, 2);
});

test('expired Vertex authorization retries once with a refreshed token, never a different model', async () => {
  let exchanges = 0, requests = 0;
  const client = new GeminiClient({ fetcher: async url => {
    if (url.endsWith('/token')) return ok({ access_token: `token-${++exchanges}` });
    requests++;
    return requests === 1 ? { ok: false, status: 401 } : ok(guide);
  } });
  await client.generate(vertex, '', '');
  assert.equal(exchanges, 2); assert.equal(requests, 2);
});

test('model capabilities reject invalid combinations and leave custom models at their defaults', () => {
  assert.throws(() => config.modelConfig({ ...vertex, geminiThinking: 'MINIMAL' }), /not supported/);
  assert.throws(() => config.modelConfig({ geminiModel: 'gemini-2.5-flash', geminiThinking: 'HIGH' }), /not supported/);
  assert.deepEqual(config.modelConfig({ geminiModel: 'gemini-2.5-flash', geminiThinking: 'off' }).generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(config.modelConfig({ geminiModel: 'gemini-custom-example' }).generationConfig.thinkingConfig, undefined);
  assert.throws(() => config.modelConfig({ geminiModel: 'gemini-example/../../other' }), /valid Gemini/);
  assert.throws(() => config.modelConfig({ apiProvider: 'gemini', geminiModel: 'gemini-3.7-flash' }), /only listed for Vertex/);
});

test('invalid credentials and unsafe project/location inputs fail before any request', async () => {
  let calls = 0;
  const client = new GeminiClient({ fetcher: async () => { calls++; throw new Error('unexpected'); } });
  for (const bad of [null, '{broken', { type: 'authorized_user' }, { ...credentials, private_key: '' }]) {
    await assert.rejects(client.generate({ ...vertex, vertexCredentials: bad }, '', ''));
  }
  for (const changes of [{ vertexLocation: 'global.evil.invalid' }, { vertexProject: '../project' }]) {
    await assert.rejects(client.generate({ ...vertex, ...changes }, '', ''));
  }
  await assert.rejects(client.generate({ ...vertex, vertexCredentials: { ...credentials, private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----' } }, '', ''), /could not be read/);
  assert.equal(calls, 0);
});

test('permission and quota errors are actionable, sanitized, and do not trigger model fallback', async () => {
  for (const [status, message] of [[403, /Access denied/], [404, /unavailable/], [429, /quota or rate limit/]]) {
    let calls = 0;
    const client = new GeminiClient({ fetcher: async () => { calls++; return { ok: false, status, async json() { throw new Error('Remote error must not be read'); } }; } });
    await assert.rejects(client.generate({ apiProvider: 'gemini', apiKey: 'secret-example' }, '', ''), message);
    assert.equal(calls, 1);
  }
});

test('blocked or truncated output never becomes an incomplete guide', async () => {
  for (const result of [{ promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"steps":[' }] } }] }]) {
    const client = new GeminiClient({ fetcher: async () => ok(result) });
    await assert.rejects(client.generate({ apiProvider: 'gemini', apiKey: 'example' }, '', ''), /blocked|output limit/);
  }
});

test('streaming safely joins split SSE/UTF-8 chunks, skips thoughts, and retains finish status', async () => {
  const events = [
    { candidates: [{ index: 0, content: { parts: [{ thought: true, text: 'Internal summary' }] } }] },
    { candidates: [{ index: 0, content: { parts: [{ text: '{"note":"Café",' }] } }] },
    { candidates: [{ index: 0, content: { parts: [{ text: '"steps":[]}' }] }, finishReason: 'STOP' }] }
  ].map(chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(events);
  const client = new GeminiClient({ fetcher: async () => new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); }
  }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.equal(await client.generate({ apiProvider: 'gemini', apiKey: 'example' }, '', ''), '{"note":"Café","steps":[]}');
});

test('an interrupted stream cannot return a partial guide', async () => {
  const client = new GeminiClient({ fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('disconnected')); }
  })) });
  await assert.rejects(client.generate({ apiProvider: 'gemini', apiKey: 'example' }, '', ''), /interrupted or invalid/);
});
