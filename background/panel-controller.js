import { SessionHistory, guidedSteps } from './session-history.js';
// Owns requests independently of the side panel's lifetime.
export class PanelController {
  constructor(browser, generateGuide) {
    this.browser = browser;
    this.generateGuide = generateGuide;
    this.history = new SessionHistory(browser);
  }

  init() {
    const browser = this.browser;
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    browser.sidePanel.onOpened?.addListener(info => this.setVisibility(info.windowId, true));
    browser.sidePanel.onClosed?.addListener(info => this.setVisibility(info.windowId, false));
    browser.tabs.onRemoved?.addListener(tabId => {
      this.closeTabSession(tabId).catch(console.error);
      browser.storage.local.remove([`activeGuide_${tabId}`, `guideme_activity_${tabId}`, `guideme_summary_${tabId}`]);
    });
    browser.runtime.onStartup?.addListener(async () => {
      // Chrome tab IDs are not durable identities across browser restarts.
      const all = await browser.storage.local.get(null);
      await browser.storage.local.remove(['activeRecording', ...Object.keys(all).filter(key => key.startsWith('guideme_session_tab_'))]);
    });
    browser.runtime.onMessage.addListener((message, sender, respond) => {
      let operation;
      if (message.type === 'GET_GUIDEME_TAB_ID') {
        respond({ tabId: sender.tab?.id || null });
        return false;
      }
      if (message.type === 'START_GUIDE_TASK') operation = this.startTask(message.payload);
      else if (message.type === 'CONTINUE_SESSION_HERE') operation = this.startTask({ ...message.payload, resumeSession: true });
      else if (message.type === 'GET_SESSION_CONTEXT') operation = this.history.context(sender.tab?.id || message.tabId).then(session => ({ session }));
      else if (message.type === 'GET_SESSION_HISTORY') operation = this.history.list().then(sessions => ({ sessions }));
      else if (message.type === 'GET_HISTORY_SESSION') operation = this.history.get(message.sessionId).then(session => ({ session }));
      else if (message.type === 'DELETE_HISTORY_SESSION') operation = this.history.delete(message.sessionId);
      else if (message.type === 'CLEAR_SESSION_HISTORY') operation = this.history.clear();
      else if (message.type === 'ATTACH_HISTORY_SESSION') operation = this.attachSession(message.sessionId, message.tabId).then(session => ({ session }));
      else if (message.type === 'SESSION_EVENT' && sender.tab) operation = this.history.append(message.sessionId, sender.tab.id, message.event);
      else if (message.type === 'SESSION_PAGE_LOADED' && sender.tab) operation = this.recordPage(sender.tab.id, sender.tab.url || message.url);
      else if (message.type === 'GET_PANEL_ACTIVITY') operation = this.getActivity(message.tabId);
      else if (message.type === 'CANCEL_GUIDE_TASK') operation = this.cancelTask(message.tabId || sender.tab?.id);
      else if (message.type === 'GUIDE_ACTIVITY' && sender.tab) operation = this.recordContentActivity(sender.tab.id, message.payload);
      else if (message.type === 'OPEN_GUIDE_PANEL' && sender.tab) {
        // Call immediately to preserve the originating button's user gesture.
        operation = browser.sidePanel.open({ windowId: sender.tab.windowId });
      } else return false;
      Promise.resolve(operation).then(result => respond(result || { success: true })).catch(error => respond({ error: error.message }));
      return true;
    });
  }

  async cancelTask(tabId) {
    await this.setActivity(tabId, { id: crypto.randomUUID(), phase: 'idle' });
    const session = await this.history.context(tabId);
    try {
      if (session) await this.history.append(session.id, tabId, { type: 'paused', text: 'Guidance stopped. Your history is retained.' });
    } finally { await this.history.detach(tabId); }
  }

  async closeTabSession(tabId) {
    const { activeRecording } = await this.browser.storage.local.get(['activeRecording']);
    const session = await this.history.context(tabId);
    try {
      if (session) await this.history.append(session.id, tabId, { type: 'paused', text: 'Tab closed. Saved instructions and progress remain available.' });
    } finally {
      if (activeRecording?.ownerTabId === tabId) await this.browser.storage.local.remove(['activeRecording']);
      await this.history.detach(tabId);
    }
  }

  async attachSession(id, tabId) {
    const state = await this.browser.tabs.sendMessage(tabId, { type: 'GET_CURRENT_GUIDE_DATA' }).catch(() => null);
    const activity = await this.getActivity(tabId);
    if (state?.isGuideActive || state?.isWaitingForAI || (activity.owner === 'background' && ['reading', 'planning'].includes(activity.phase))) throw new Error('Stop the current guide before opening a different session.');
    const session = await this.history.bind(id, tabId);
    // The archived instructions replace only an inactive page report, never a running guide.
    await this.browser.tabs.sendMessage(tabId, { type: 'DISMISS_GUIDE_OUTCOME' }).catch(() => {});
    return session;
  }

  async recordPage(tabId, url) {
    const session = await this.history.context(tabId);
    if (session && session.events.at(-1)?.url !== url) await this.history.append(session.id, tabId, { type: 'page', url });
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

  async startTask({ task, tabId, highlightColor, sessionId, resumeSession = false }) {
    const browser = this.browser;
    const tab = tabId ? await browser.tabs.get(tabId) : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a website to start a guide.');
    const { activeRecording } = await browser.storage.local.get(['activeRecording']);
    if (activeRecording?.isRecording && activeRecording.ownerTabId === tab.id) throw new Error('Stop recording before starting guidance in this tab.');
    const id = crypto.randomUUID();
    let session = null;
    let historyError = null;
    try {
      session = resumeSession ? await this.history.bind(sessionId, tab.id) : await this.history.start({ id, tabId: tab.id, task, url: tab.url });
    } catch (error) { historyError = error.message; }
    if (resumeSession && !session) throw new Error(historyError || 'The history session could not be opened.');
    task = session?.task || task;
    const journeyId = session?.id || id;
    const completedSteps = guidedSteps(session);
    const guidancePreference = resumeSession ? 'step-by-step' : 'auto';
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
      await browser.tabs.sendMessage(tab.id, { type: 'PREPARE_GUIDE_TASK', task, sessionId: journeyId, historyError, guidancePreference });
      await this.setActivity(tab.id, { ...base, phase: 'planning' });
      const result = await this.generateGuide({ task, url: dom.url, title: dom.title, dom, completedSteps, guidancePreference });
      try { await this.history.advice(journeyId, tab.id, result, dom.url); }
      catch (error) { historyError = error.message; }
      if (!await current()) return { cancelled: true };
      if ((await browser.tabs.get(tab.id)).url !== dom.url) throw new Error('The page changed while planning. Start again from this page.');
      if (!await current()) return { cancelled: true };
      if (!result.steps?.length) {
        const status = ['complete', 'handoff', 'blocked'].includes(result.status) ? result.status : 'handoff';
        await browser.tabs.sendMessage(tab.id, { type: 'SHOW_GUIDE_OUTCOME', payload: { ...result, status, task, tabId: tab.id, sessionId: journeyId, historyError, completedSteps, startUrl: session?.startUrl || tab.url } });
        if (await current()) await this.setActivity(tab.id, { ...base, owner: 'content', phase: status });
        return { ...result, tabId: tab.id };
      }
      await browser.tabs.sendMessage(tab.id, {
        type: 'START_GUIDE', payload: { steps: result.steps, task, highlightColor, isFinalStepBatch: result.completed === true, presentationMode: 'sidepanel', sessionId: journeyId, historyError, completedSteps, startUrl: session?.startUrl || tab.url }
      });
      if (await current()) await this.setActivity(tab.id, { ...base, owner: 'content', phase: 'locating' });
      return { ...result, tabId: tab.id };
    } catch (error) {
      if (await current()) {
        try { await this.history.append(journeyId, tab.id, { type: 'paused', text: error.message, url: tab.url }); } catch {}
        await this.setActivity(tab.id, { ...base, owner: 'content', phase: 'error', detail: error.message });
        await browser.tabs.sendMessage(tab.id, { type: 'GUIDE_TASK_ERROR', error: error.message }).catch(() => {});
      }
      throw error;
    }
  }
}
