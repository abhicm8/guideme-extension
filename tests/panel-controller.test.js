import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PanelController } from '../background/panel-controller.js';

function environment() {
  const storage = { apiKey: 'test-only', apiProvider: 'gemini' };
  const sent = [];
  const tab = { id: 8, windowId: 2, url: 'https://example.com/' };
  const browser = {
    storage: { local: { async get() { return { ...storage }; }, async set(value) { Object.assign(storage, value); } } },
    tabs: {
      async get() { return { ...tab }; }, async query() { return [{ ...tab }]; },
      async sendMessage(id, message) {
        sent.push({ id, ...message });
        return message.type === 'GET_DOM' ? { url: tab.url, title: 'Example', elements: [] } : { success: true };
      }
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} }
  };
  return { browser, storage, sent, tab };
}

test('toolbar opens a native side panel instead of a temporary popup', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel.default_path, 'popup/popup.html');
  assert.equal(manifest.action.default_popup, undefined);
});

test('background delivers the generated guide independently of any panel connection', async () => {
  const env = environment();
  const controller = new PanelController(env.browser, async () => ({ steps: [{ element: 'gm-doc-1', action: 'click' }] }));
  await controller.startTask({ task: 'Open settings', tabId: 8 });
  assert.equal(env.sent.find(message => message.type === 'START_GUIDE').payload.presentationMode, 'sidepanel');
  assert.equal((await controller.getActivity(8)).phase, 'locating');
});

test('cancelled background requests cannot revive a guide', async () => {
  const env = environment();
  let finish, planning;
  const began = new Promise(resolve => { planning = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  const controller = new PanelController(env.browser, () => { planning(); return result; });
  const operation = controller.startTask({ task: 'Old request', tabId: 8 });
  await began;
  await controller.setActivity(8, { id: 'cancelled', phase: 'idle' });
  finish({ steps: [{ element: 'gm-doc-1', action: 'click' }] });
  assert.equal((await operation).cancelled, true);
  assert.equal(env.sent.some(message => message.type === 'START_GUIDE'), false);
});

test('navigation during planning rejects stale guidance and publishes an actionable error', async () => {
  const env = environment();
  const controller = new PanelController(env.browser, async () => {
    env.tab.url = 'https://example.com/another-page';
    return { steps: [{ element: 'gm-doc-1', action: 'click' }] };
  });
  await assert.rejects(controller.startTask({ task: 'Open settings', tabId: 8 }), /page changed/);
  assert.equal((await controller.getActivity(8)).phase, 'error');
  assert.equal(env.sent.some(message => message.type === 'START_GUIDE'), false);
});

test('old content cleanup cannot overwrite a new in-flight background request', async () => {
  const env = environment();
  const controller = new PanelController(env.browser, () => {});
  await controller.setActivity(8, { id: 'new', owner: 'background', phase: 'planning' });
  await controller.recordContentActivity(8, { phase: 'idle' });
  assert.equal((await controller.getActivity(8)).phase, 'planning');
});

test('a first-request handoff reaches the page as a summary without starting an empty guide', async () => {
  const env = environment();
  const outcome = { steps: [], status: 'handoff', summary: 'The form is open. Enter the required details, review, then submit.', remainingActions: [{ text: 'Enter the required details.' }] };
  const controller = new PanelController(env.browser, async () => outcome);
  const result = await controller.startTask({ task: 'How do I submit this?', tabId: 8 });
  assert.equal(result.status, 'handoff');
  assert.equal(env.sent.some(message => message.type === 'START_GUIDE'), false);
  assert.equal(env.sent.find(message => message.type === 'SHOW_GUIDE_OUTCOME').payload.summary, outcome.summary);
  assert.equal((await controller.getActivity(8)).phase, 'handoff');
});
