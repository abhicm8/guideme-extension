// Owns requests independently of the side panel's lifetime.
export class PanelController {
  constructor(browser, generateGuide) {
    this.browser = browser;
    this.generateGuide = generateGuide;
  }

  init() {
    const browser = this.browser;
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    browser.sidePanel.onOpened?.addListener(info => this.setVisibility(info.windowId, true));
    browser.sidePanel.onClosed?.addListener(info => this.setVisibility(info.windowId, false));
    browser.tabs.onRemoved?.addListener(tabId => browser.storage.local.remove([`activeGuide_${tabId}`, `guideme_activity_${tabId}`, `guideme_summary_${tabId}`]));
    browser.runtime.onMessage.addListener((message, sender, respond) => {
      let operation;
      if (message.type === 'GET_GUIDEME_TAB_ID') {
        respond({ tabId: sender.tab?.id || null });
        return false;
      }
      if (message.type === 'START_GUIDE_TASK') operation = this.startTask(message.payload);
      else if (message.type === 'GET_PANEL_ACTIVITY') operation = this.getActivity(message.tabId);
      else if (message.type === 'CANCEL_GUIDE_TASK') operation = this.setActivity(message.tabId || sender.tab?.id, { id: crypto.randomUUID(), phase: 'idle' });
      else if (message.type === 'GUIDE_ACTIVITY' && sender.tab) operation = this.recordContentActivity(sender.tab.id, message.payload);
      else if (message.type === 'OPEN_GUIDE_PANEL' && sender.tab) {
        // Call immediately to preserve the originating button's user gesture.
        operation = browser.sidePanel.open({ windowId: sender.tab.windowId });
      } else return false;
      Promise.resolve(operation).then(result => respond(result || { success: true })).catch(error => respond({ error: error.message }));
      return true;
    });
  }

  async setVisibility(windowId, visible) {
    const tabs = await this.browser.tabs.query({ active: true, windowId });
    await Promise.allSettled(tabs.map(tab => this.browser.tabs.sendMessage(tab.id, { type: 'SET_PANEL_VISIBILITY', visible })));
  }

  async getActivity(tabId) {
    const key = `guideme_activity_${tabId}`;
    return (await this.browser.storage.local.get([key]))[key] || { phase: 'idle' };
  }

  async setActivity(tabId, activity) {
    const record = { ...activity, updatedAt: Date.now() };
    await this.browser.storage.local.set({ [`guideme_activity_${tabId}`]: record });
    const busy = ['reading', 'planning', 'locating', 'verifying'].includes(activity.phase);
    const text = busy ? '···' : activity.phase === 'error' || activity.phase === 'attention' ? '!' : activity.phase === 'ready' ? '•' : '';
    await this.browser.action.setBadgeText({ tabId, text });
    await this.browser.action.setBadgeBackgroundColor({ tabId, color: busy ? '#426d63' : '#78623b' });
    return record;
  }

  async recordContentActivity(tabId, activity) {
    const existing = await this.getActivity(tabId);
    // An old guide's final cleanup must not erase a newly requested plan.
    if (['reading', 'planning'].includes(existing.phase) && existing.owner === 'background') return;
    return this.setActivity(tabId, { ...activity, id: existing.id, owner: 'content' });
  }

  async startTask({ task, tabId, highlightColor }) {
    const browser = this.browser;
    const tab = tabId ? await browser.tabs.get(tabId) : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a website to start a guide.');
    const id = crypto.randomUUID();
    const base = { id, task, owner: 'background' };
    const current = async () => (await this.getActivity(tab.id)).id === id;
    await this.setActivity(tab.id, { ...base, phase: 'reading' });
    try {
      let dom;
      try { dom = await browser.tabs.sendMessage(tab.id, { type: 'GET_DOM' }); }
      catch {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-intelligence.js', 'content/step-verifier.js', 'content/content.js'] });
        await browser.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/overlay.css'] });
        dom = await browser.tabs.sendMessage(tab.id, { type: 'GET_DOM' });
      }
      if (!await current()) return { cancelled: true };
      await browser.tabs.sendMessage(tab.id, { type: 'PREPARE_GUIDE_TASK', task });
      await this.setActivity(tab.id, { ...base, phase: 'planning' });
      const result = await this.generateGuide({ task, url: dom.url, title: dom.title, dom });
      if (!await current()) return { cancelled: true };
      if ((await browser.tabs.get(tab.id)).url !== dom.url) throw new Error('The page changed while planning. Start again from this page.');
      if (!await current()) return { cancelled: true };
      if (!result.steps?.length) {
        const status = ['complete', 'handoff', 'blocked'].includes(result.status) ? result.status : 'handoff';
        await browser.tabs.sendMessage(tab.id, { type: 'SHOW_GUIDE_OUTCOME', payload: { ...result, status, task, tabId: tab.id } });
        if (await current()) await this.setActivity(tab.id, { ...base, owner: 'content', phase: status });
        return { ...result, tabId: tab.id };
      }
      await browser.tabs.sendMessage(tab.id, {
        type: 'START_GUIDE', payload: { steps: result.steps, task, highlightColor, isFinalStepBatch: result.completed === true, presentationMode: 'sidepanel' }
      });
      if (await current()) await this.setActivity(tab.id, { ...base, owner: 'content', phase: 'locating' });
      return { ...result, tabId: tab.id };
    } catch (error) {
      if (await current()) {
        await this.setActivity(tab.id, { ...base, owner: 'content', phase: 'error', detail: error.message });
        await browser.tabs.sendMessage(tab.id, { type: 'GUIDE_TASK_ERROR', error: error.message }).catch(() => {});
      }
      throw error;
    }
  }
}
