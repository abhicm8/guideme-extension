import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real message listeners and planner without a live cloud account.
const listeners = [];
const settings = { apiProvider: 'gemini', apiKey: 'local-key', geminiModel: 'gemini-3.6-flash', geminiThinking: 'LOW' };
const requests = [];
globalThis.chrome = {
  runtime: { onMessage: { addListener(listener) { listeners.push(listener); } }, async getPlatformInfo() { return {}; } },
  sidePanel: { async setPanelBehavior() {} }, tabs: {},
  storage: { local: { async get(keys) { return Object.fromEntries(keys.map(key => [key, settings[key]])); } } }
};
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (url.endsWith('/token')) return { ok: true, status: 200, async json() { return { access_token: 'test-access-token', expires_in: 3600 }; } };
  return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({ steps: [{ element: 'gm-doc-1', action: 'click', description: 'Open Settings' }] }) }] }, finishReason: 'STOP' }] }; } };
};
await import('../background/background.js');
const listener = listeners.at(-1);
const dom = { snapshotId: 'doc:1', elements: [{ id: 'gm-doc-1', name: 'Settings', role: 'button', type: 'button', enabled: true }] };
const payload = { task: 'Open Settings', url: 'https://example.com/', title: 'Dashboard', dom, apiProvider: 'vertex', apiKey: 'message-override' };
function dispatch(type) { return new Promise(resolve => listener({ type, payload }, {}, resolve)); }

test('initial and continued guides both read the worker configuration and ignore message-supplied provider credentials', async () => {
  const initial = await dispatch('GENERATE_GUIDE');
  assert.equal(initial.steps[0].element, 'gm-doc-1');
  assert.equal(initial.steps[0].snapshotId, 'doc:1');
  settings.geminiModel = 'gemini-3.8-flash'; settings.geminiThinking = 'HIGH';
  const continued = await dispatch('CONTINUE_GUIDE');
  assert.equal(continued.steps[0].element, 'gm-doc-1');
  assert.match(requests[0].url, /gemini-3\.6-flash:streamGenerateContent/);
  assert.match(requests[1].url, /gemini-3\.8-flash:streamGenerateContent/);
  for (const request of requests) {
    assert.equal(request.options.headers['x-goog-api-key'], 'local-key');
    assert.equal(request.options.body.includes('local-key'), false);
    assert.equal(request.options.body.includes('message-override'), false);
  }
  assert.deepEqual(JSON.parse(requests[1].options.body).generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
});

test('Vertex supports initial and continuation planning with no API key and keeps credentials out of returned plans', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  settings.vertexCredentials = { type: 'service_account', project_id: 'test-project', client_email: 'demo@test-project.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----\n` };
  settings.apiProvider = 'vertex'; settings.apiKey = '';
  requests.length = 0;
  for (const type of ['GENERATE_GUIDE', 'CONTINUE_GUIDE']) {
    const result = await dispatch(type);
    assert.equal(result.steps[0].element, 'gm-doc-1');
    assert.equal(JSON.stringify(result).includes('private_key'), false);
    assert.equal(JSON.stringify(result).includes('test-access-token'), false);
  }
  const auth = requests.filter(request => request.url.endsWith('/token'));
  const generation = requests.filter(request => !request.url.endsWith('/token'));
  assert.equal(auth.length, 1);
  assert.equal(generation.length, 2);
  for (const request of generation) {
    assert.match(request.url, /^https:\/\/aiplatform.googleapis.com\/v1\/projects\/test-project\//);
    assert.equal(request.options.headers.Authorization, 'Bearer test-access-token');
    assert.equal(request.options.body.includes('PRIVATE KEY'), false);
    assert.equal(request.options.body.includes('gserviceaccount.com'), false);
  }
});

test('the worker repairs a repeated completed action once, then hands off rather than looping', async () => {
  payload.completedSteps = [{ element: 'gm-doc-1', action: 'click', description: 'Open Settings', verification: 'manual', targetDescriptor: dom.elements[0], pageUrl: payload.url }];
  dom.url = payload.url;
  const originalFetcher = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    if (calls === 2) {
      assert.match(JSON.parse(JSON.parse(options.body).contents[0].parts[0].text).planningFeedback, /already recorded/);
      return { ok: true, status: 200, async json() { return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ steps: [], completed: false, note: 'Enter details in the open form.' }) }] } }] }; } };
    }
    return originalFetcher(url, options);
  };
  try {
    const result = await dispatch('CONTINUE_GUIDE');
    assert.equal(calls, 2);
    assert.equal(result.steps.length, 0);
    globalThis.fetch = originalFetcher;
    const repeated = await dispatch('CONTINUE_GUIDE');
    assert.equal(repeated.status, 'handoff');
    assert.equal(repeated.completed, false);
    assert.ok(repeated.summary);
    assert.ok(repeated.remainingActions.length);
  } finally { globalThis.fetch = originalFetcher; delete payload.completedSteps; }
});

test('unavailable model targets get one repair attempt, then a useful ending instead of an invalid highlight', async () => {
  const originalFetcher = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, async json() { return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ steps: [{ element: 'invented-target', action: 'click', description: 'Click an unavailable control' }] }) }] } }] }; } };
  };
  try {
    const result = await dispatch('CONTINUE_GUIDE');
    assert.equal(calls, 2);
    assert.equal(result.steps.length, 0);
    assert.equal(result.completed, false);
    assert.ok(result.summary);
    assert.ok(result.remainingActions.length);
    assert.equal(result.error, undefined);
  } finally { globalThis.fetch = originalFetcher; }
});
