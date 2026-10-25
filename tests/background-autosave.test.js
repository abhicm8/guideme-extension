import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = [];
const data = {};
let failNextWrite = false;
globalThis.chrome = {
  runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
  sidePanel: { async setPanelBehavior() {} }, tabs: {},
  storage: { local: {
    async get(keys) {
      // Storage returns snapshots, not live references shared by different requests.
      await new Promise(resolve => setTimeout(resolve, 1));
      return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]])));
    },
    async set(values) {
      if (failNextWrite) { failNextWrite = false; throw new Error('Storage quota exceeded'); }
      await new Promise(resolve => setTimeout(resolve, 1));
      Object.assign(data, structuredClone(values));
    }
  } }
};
await import('../background/background.js');
const listener = listeners.at(-1);
const dispatch = (type, payload) => new Promise(resolve => listener({ type, payload }, {}, resolve));
const session = (id, count = 1, status = 'handoff') => ({
  name: `Session ${id}`, task: 'Configure options', startUrl: 'https://example.com/start', sourceSessionId: id,
  steps: Array.from({ length: count }, (_, index) => ({ action: 'click', description: `Step ${index}`, robustSelectors: { id: `control-${index}` }, verification: 'verified' })),
  outcome: { status, summary: 'Review the open form.', remainingActions: [{ text: 'Review and save.' }], finishedAt: count }
});

test('completed guided actions reach the Library with their actual outcome and replay targets', async () => {
  const result = await dispatch('SAVE_MACRO', session('initial'));
  assert.equal(result.success, true);
  const stored = (await dispatch('GET_MACROS')).find(guide => guide.sourceSessionId === 'initial');
  assert.equal(stored.outcome.status, 'handoff');
  assert.equal(stored.startUrl, 'https://example.com/start');
  assert.equal(stored.steps[0].robustSelectors.id, 'control-0');
});

test('simultaneous tab saves do not overwrite each other', async () => {
  const results = await Promise.all(['tab-a', 'tab-b', 'tab-c'].map(id => dispatch('SAVE_MACRO', session(id))));
  assert.ok(results.every(result => result.success));
  const guides = await dispatch('GET_MACROS');
  for (const id of ['tab-a', 'tab-b', 'tab-c']) assert.equal(guides.filter(guide => guide.sourceSessionId === id).length, 1);
  assert.equal(new Set(results.map(result => result.macro.id)).size, 3);
});

test('retrying and resuming one journey updates a single Library entry without truncating it', async () => {
  const first = await dispatch('SAVE_MACRO', session('resume'));
  await dispatch('SAVE_MACRO', session('resume'));
  const completed = await dispatch('SAVE_MACRO', session('resume', 3, 'complete'));
  const lateRetry = await dispatch('SAVE_MACRO', session('resume'));
  assert.equal(completed.macro.id, first.macro.id);
  assert.equal(lateRetry.macro.steps.length, 3);
  const guides = (await dispatch('GET_MACROS')).filter(guide => guide.sourceSessionId === 'resume');
  assert.equal(guides.length, 1);
  assert.equal(guides[0].outcome.status, 'complete');
});

test('storage failures return an error and a subsequent retry can save', async () => {
  failNextWrite = true;
  const failed = await dispatch('SAVE_MACRO', session('retry'));
  assert.match(failed.error, /quota/);
  assert.equal((await dispatch('GET_MACROS')).some(guide => guide.sourceSessionId === 'retry'), false);
  assert.equal((await dispatch('SAVE_MACRO', session('retry'))).success, true);
});

test('empty sessions cannot create misleading empty Library entries', async () => {
  assert.match((await dispatch('SAVE_MACRO', session('empty', 0))).error, /No recorded steps/);
});

test('history can save a recorded journey as a walkthrough without turning suggestions into actions', async () => {
  data.guideme_session_recorded = {
    id: 'recorded', task: 'A demonstrated workflow', startUrl: 'https://example.com/start', status: 'handoff', updatedAt: 10,
    events: [
      { type: 'advice', instructions: [{ text: 'Suggested but never performed' }] },
      { type: 'action', source: 'recorded', step: { action: 'click', description: 'Opened options', robustSelectors: { id: 'options' } } }
    ]
  };
  const result = await new Promise(resolve => listener({ type: 'SAVE_HISTORY_WALKTHROUGH', sessionId: 'recorded' }, {}, resolve));
  assert.equal(result.success, true);
  assert.equal(result.macro.steps.length, 1);
  assert.equal(result.macro.steps[0].robustSelectors.id, 'options');
  assert.equal(result.macro.isRecorded, true);
  assert.equal(result.macro.outcome.status, 'handoff');
});
