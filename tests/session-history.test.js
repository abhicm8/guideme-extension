import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionHistory, guidedSteps } from '../background/session-history.js';
import { PanelController } from '../background/panel-controller.js';
function environment() {
  const data = {};
  let fail = false;
  const browser = { storage: { local: {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); },
    async set(values) { if (fail) { fail = false; throw new Error('Storage full'); } Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of keys) delete data[key]; }
  } } };
  return { browser, data, failNext() { fail = true; } };
}
const start = { id: 'session-a', tabId: 8, task: 'Create a private repository', url: 'https://example.com/' };
const advice = { status: 'handoff', summary: 'Open Create new, choose New repository, and set Private.', steps: [], remainingActions: [{ text: 'Enter a repository name.' }, { text: 'Choose Private.' }] };

test('advice with zero actions survives tab closure and a new worker', async () => {
  const env = environment(); const history = new SessionHistory(env.browser);
  await history.start(start);
  await history.advice(start.id, 8, advice, start.url);
  await history.detach(8);
  const restored = new SessionHistory(env.browser);
  assert.equal((await restored.context(8)), null);
  const session = await restored.get(start.id);
  assert.equal(session.events[1].text, advice.summary);
  assert.deepEqual(session.events[1].remainingActions, advice.remainingActions);
  assert.equal((await restored.list())[0].actionCount, 0);
});

test('navigation and a second request retain the previous instructions and progress', async () => {
  const env = environment(); const history = new SessionHistory(env.browser);
  await history.start(start); await history.advice(start.id, 8, advice, start.url);
  await history.append(start.id, 8, { type: 'page', url: 'https://example.com/new' });
  assert.equal((await history.context(8)).events[1].text, advice.summary);
  await history.start({ ...start, id: 'session-b', task: 'Another task' });
  assert.equal((await history.list()).length, 2);
  assert.equal((await history.get(start.id)).events.length, 3);
  assert.equal((await history.context(8)).id, 'session-b');
});

test('parallel events stay ordered and retried actions are not duplicated', async () => {
  const env = environment(); const history = new SessionHistory(env.browser);
  await history.start(start);
  const action = { id: 'click-1', type: 'action', source: 'guided', step: { description: 'Open form', verification: 'observed' } };
  await Promise.all([history.append(start.id, 8, action), history.append(start.id, 8, action), history.advice(start.id, 8, advice, start.url)]);
  const session = await history.get(start.id);
  assert.equal(session.events.length, 3);
  assert.deepEqual(guidedSteps(session), [action.step]);
});

test('recorded edits update their focus observation without becoming verified actions', async () => {
  const env = environment(); const history = new SessionHistory(env.browser); await history.start(start);
  await history.append(start.id, 8, { id: 'edit', type: 'action', source: 'recorded', step: { action: 'focus' } });
  await history.append(start.id, 8, { id: 'edit', type: 'action', source: 'recorded', step: { action: 'type' } });
  assert.equal((await history.get(start.id)).events.length, 2);
  assert.equal((await history.get(start.id)).events[1].step.action, 'type');
  assert.deepEqual(guidedSteps(await history.get(start.id)), []);
});

test('events from another tab or replaced session cannot contaminate history', async () => {
  const env = environment(); const history = new SessionHistory(env.browser); await history.start(start);
  assert.equal(await history.append(start.id, 9, { type: 'page' }), null);
  await history.start({ ...start, id: 'replacement' });
  assert.equal(await history.append(start.id, 8, { type: 'page' }), null);
  assert.equal((await history.get(start.id)).events.length, 1);
});

test('history preference stops new persistence and removes the stale workspace binding', async () => {
  const env = environment(); const history = new SessionHistory(env.browser); await history.start(start);
  env.data.saveSessionHistory = false;
  assert.equal(await history.start({ ...start, id: 'disabled' }), null);
  assert.equal(await history.context(8), null);
  assert.equal((await history.list()).length, 1);
});

test('delete and clear remove history without deleting Library walkthroughs', async () => {
  const env = environment(); const history = new SessionHistory(env.browser);
  env.data.guideme_macros = [{ id: 'saved-guide' }];
  await history.start(start); await history.start({ ...start, id: 'b' });
  await history.delete(start.id); assert.equal(await history.get(start.id), null);
  await history.clear(); assert.deepEqual(await history.list(), []);
  assert.equal(await history.get('b'), null);
  assert.deepEqual(env.data.guideme_macros, [{ id: 'saved-guide' }]);
});

test('storage failure is reported without poisoning the event queue', async () => {
  const env = environment(); const history = new SessionHistory(env.browser); await history.start(start);
  env.failNext(); await assert.rejects(history.advice(start.id, 8, advice, start.url), /Storage full/);
  await history.advice(start.id, 8, advice, start.url);
  assert.equal((await history.get(start.id)).events.length, 2);
});

test('explicit continuation reads the new page and retains the same session and earlier actions', async () => {
  const env = environment();
  const sent = [];
  const tab = { id: 8, windowId: 1, url: 'https://example.com/new' };
  env.browser.tabs = { async get() { return tab; }, async sendMessage(id, message) {
    sent.push(message); return message.type === 'GET_DOM' ? { url: tab.url, title: 'New page', elements: [] } : { success: true };
  } };
  env.browser.action = { async setBadgeText() {}, async setBadgeBackgroundColor() {} };
  let input;
  const controller = new PanelController(env.browser, async payload => { input = payload; return advice; });
  await controller.history.start(start);
  await controller.history.append(start.id, 8, { type: 'action', source: 'guided', step: { description: 'Opened Create new', verification: 'observed' } });
  await controller.startTask({ tabId: 8, sessionId: start.id, resumeSession: true });
  assert.equal(input.url, tab.url);
  assert.equal(input.task, start.task);
  assert.equal(input.completedSteps.length, 1);
  assert.equal(input.guidancePreference, 'step-by-step');
  assert.equal(sent.find(message => message.type === 'SHOW_GUIDE_OUTCOME').payload.sessionId, start.id);
  assert.equal((await controller.history.list()).length, 1);
});

test('closing a recording tab keeps progress and releases recording ownership', async () => {
  const env = environment();
  const controller = new PanelController(env.browser, () => {});
  await controller.history.start(start);
  await controller.history.advice(start.id, 8, advice, start.url);
  env.data.activeRecording = { ownerTabId: 8, sessionId: start.id, isRecording: true };
  await controller.closeTabSession(8);
  assert.equal(env.data.activeRecording, undefined);
  assert.equal(await controller.history.context(8), null);
  assert.equal((await controller.history.get(start.id)).status, 'paused');
  assert.equal((await controller.history.get(start.id)).events[1].text, advice.summary);
});

test('history cannot replace a session while the same tab is recording', async () => {
  const env = environment(); const history = new SessionHistory(env.browser);
  await history.start(start); await history.start({ ...start, id: 'other', tabId: 9 });
  env.data.activeRecording = { isRecording: true, ownerTabId: 8, sessionId: start.id };
  await assert.rejects(history.bind('other', 8), /Stop recording/);
  assert.equal((await history.context(8)).id, start.id);
});

test('closing a completed session retains its observed completion outcome', async () => {
  const env = environment(); const controller = new PanelController(env.browser, () => {});
  await controller.history.start(start);
  await controller.history.append(start.id, 8, { type: 'outcome', status: 'complete', text: 'The page reports completion.' });
  await controller.closeTabSession(8);
  assert.equal((await controller.history.get(start.id)).status, 'complete');
});

test('opening archived instructions dismisses an inactive report and refuses to replace a running guide', async () => {
  const env = environment(); const sent = []; let active = false;
  env.browser.tabs = { async sendMessage(tabId, message) { sent.push(message.type); return { isGuideActive: active }; } };
  const controller = new PanelController(env.browser, () => {});
  await controller.history.start(start);
  assert.equal((await controller.attachSession(start.id, 8)).id, start.id);
  assert.ok(sent.includes('DISMISS_GUIDE_OUTCOME'));
  active = true; sent.length = 0;
  await assert.rejects(controller.attachSession(start.id, 8), /Stop the current guide/);
  assert.equal(sent.includes('DISMISS_GUIDE_OUTCOME'), false);
});
