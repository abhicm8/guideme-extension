// History is read-only until the user explicitly continues guidance or starts recording.
class GuideMeHistoryUI {
  statusLabel(status) { return ({ complete: 'Page reports completion', handoff: 'Over to you', blocked: 'Needs more context', paused: 'Paused' })[status] || 'In progress'; }
  constructor(popup) {
    this.popup = popup;
    this.session = null;
    this.tabId = null;
    this.viewedId = null;
    this.version = 0;
    document.getElementById('historyBtn').addEventListener('click', () => popup.showView('history'));
    document.getElementById('backFromHistoryBtn').addEventListener('click', () => popup.showView('main'));
    document.getElementById('openSessionHistoryBtn').addEventListener('click', () => { this.viewedId = this.session?.id; popup.showView('history'); });
    document.getElementById('continueSessionBtn').addEventListener('click', () => this.continueHere());
    document.getElementById('recordSessionBtn').addEventListener('click', () => this.record());
    document.getElementById('pauseSessionRecordingBtn').addEventListener('click', () => this.recordingAction('PAUSE_RECORDING'));
    document.getElementById('resumeSessionRecordingBtn').addEventListener('click', () => this.recordingAction('RESUME_RECORDING'));
    document.getElementById('stopSessionRecordingBtn').addEventListener('click', () => this.recordingAction('STOP_RECORDING'));
    document.getElementById('saveHistoryWalkthroughBtn').addEventListener('click', async () => {
      const result = await this.call({ type: 'SAVE_HISTORY_WALKTHROUGH', sessionId: this.viewedId });
      if (result) popup.showStatus('Walkthrough saved to Library.', 'success');
    });
    document.getElementById('attachSessionBtn').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!/^https?:/.test(tab?.url || '')) return popup.showStatus('Open a website to continue this session.', 'info');
      if (await this.call({ type: 'ATTACH_HISTORY_SESSION', sessionId: this.viewedId, tabId: tab.id })) {
        popup.showView('main'); await popup.restoreGuideStateFromContentScript();
      }
    });
    document.getElementById('deleteHistorySessionBtn').addEventListener('click', async () => {
      if (await this.call({ type: 'DELETE_HISTORY_SESSION', sessionId: this.viewedId })) { this.viewedId = null; await this.load(); }
    });
    document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
      if (!window.confirm('Delete all saved session history? Library walkthroughs will remain.')) return;
      if (await this.call({ type: 'CLEAR_SESSION_HISTORY' })) { this.viewedId = null; await this.load(); }
    });
  }
  async call(message) {
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (result?.error) throw new Error(result.error);
      return result;
    } catch (error) { this.popup.showStatus(error.message || 'History could not be loaded.', 'error'); return null; }
  }
  async refresh(tab, active, data) {
    const version = ++this.version;
    const [result, storage] = await Promise.all([
      this.call({ type: 'GET_SESSION_CONTEXT', tabId: tab.id }), chrome.storage.local.get(['activeRecording'])
    ]);
    if (version !== this.version || this.popup.activeTabId !== tab.id) return;
    this.session = result?.session || null;
    this.tabId = tab.id;
    const card = document.getElementById('sessionContextCard');
    const visible = this.session && ['main', 'guide'].includes(this.popup.currentView);
    card.classList.toggle('hidden', !visible);
    if (!visible) return;
    document.getElementById('sessionTaskTitle').textContent = this.session.task;
    if (data?.lastGuideSummary?.save?.state === 'empty') document.getElementById('summarySaveStatus').textContent = 'No actions recorded yet. Your instructions are saved in History.';
    const last = [...this.session.events].reverse().find(event => event.type === 'outcome' || event.type === 'advice');
    document.getElementById('sessionHistoryStatus').textContent = last ? 'Instructions and progress saved to History' : 'Request saved to History';
    const fingerprint = JSON.stringify([this.session.id, last]);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      document.getElementById('sessionInstructions').open = !active && !data?.lastGuideSummary;
      const copy = document.getElementById('sessionInstructionsCopy'); copy.replaceChildren();
      if (last?.text) { const text = document.createElement('p'); text.textContent = last.text; copy.append(text); }
      const instructions = [...(last?.instructions || []), ...(last?.remainingActions || [])];
      const list = document.createElement('ol');
      for (const item of instructions) { const li = document.createElement('li'); li.textContent = typeof item === 'string' ? item : item.text; list.append(li); }
      if (instructions.length) copy.append(list);
      const where = document.createElement('p'); where.className = 'history-meta';
      where.textContent = last?.url && last.url !== tab.url ? 'Advice from an earlier page. Continue here to get guidance for this page.' : 'Suggested instructions. Recorded actions appear separately in History.';
      copy.append(where);
    }
    const recording = storage.activeRecording?.isRecording && storage.activeRecording.ownerTabId === tab.id && storage.activeRecording.sessionId === this.session.id ? storage.activeRecording : null;
    if (data?.lastGuideSummary) document.getElementById('resumeGuideBtn').classList.add('hidden');
    this.recording = recording;
    document.getElementById('recordSessionBtn').classList.toggle('hidden', active || !!recording);
    document.getElementById('continueSessionBtn').classList.toggle('hidden', active || !!recording);
    document.getElementById('sessionRecordingControls').classList.toggle('hidden', !recording);
    document.getElementById('pauseSessionRecordingBtn').classList.toggle('hidden', !recording || recording.paused);
    document.getElementById('resumeSessionRecordingBtn').classList.toggle('hidden', !recording?.paused);
    document.getElementById('sessionRecordingStatus').textContent = recording ? `${recording.paused ? 'Paused' : 'Recording'} · ${recording.steps?.length || 0} actions · this tab` : '';
  }
  async continueHere() {
    if (!this.session || !this.tabId) return;
    const button = document.getElementById('continueSessionBtn');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== this.tabId) return this.popup.restoreGuideStateFromContentScript();
      if (await this.call({ type: 'CONTINUE_SESSION_HERE', payload: { sessionId: this.session.id, tabId: this.tabId, highlightColor: this.popup.settings.highlightColor } })) await this.popup.restoreGuideStateFromContentScript();
    } finally { button.disabled = false; }
  }
  async record() {
    if (!this.session || !this.tabId) return;
    const button = document.getElementById('recordSessionBtn');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== this.tabId) return this.popup.restoreGuideStateFromContentScript();
      const result = await chrome.tabs.sendMessage(this.tabId, { type: 'START_RECORDING', payload: { sessionId: this.session.id } });
      if (result?.error) throw new Error(result.error);
      await this.popup.restoreGuideStateFromContentScript();
    } catch (error) { this.popup.showStatus(error.message || 'Could not start recording.', 'error'); }
    finally { button.disabled = false; }
  }
  async recordingAction(type) {
    try {
      const result = await chrome.tabs.sendMessage(this.tabId, { type });
      if (result?.error) throw new Error(result.error);
      if (type === 'STOP_RECORDING') this.popup.showStatus('Recording stopped. Actions are saved in session History.', 'success');
      await this.popup.restoreGuideStateFromContentScript();
    } catch (error) { this.popup.showStatus(error.message || 'Could not update recording.', 'error'); }
  }
  async load() {
    const result = await this.call({ type: 'GET_SESSION_HISTORY' });
    if (this.popup.currentView !== 'history') return;
    const list = document.getElementById('historyList'); list.replaceChildren();
    const sessions = result?.sessions || [];
    document.getElementById('historyEmpty').classList.toggle('hidden', !!sessions.length);
    for (const session of sessions) {
      const button = document.createElement('button'); button.className = 'history-session';
      const title = document.createElement('strong'); title.textContent = session.task;
      const meta = document.createElement('span'); meta.className = 'history-meta';
      meta.textContent = `${new Date(session.updatedAt).toLocaleString()} · ${session.actionCount} actions · ${this.statusLabel(session.status)}`;
      button.append(title, meta); button.addEventListener('click', () => { this.viewedId = session.id; this.loadDetail(); }); list.append(button);
    }
    await this.loadDetail();
  }
  async loadDetail() {
    const id = this.viewedId;
    const result = id ? await this.call({ type: 'GET_HISTORY_SESSION', sessionId: id }) : null;
    if (id !== this.viewedId) return;
    const session = result?.session;
    document.getElementById('historyDetail').classList.toggle('hidden', !session);
    if (!session) return;
    document.getElementById('historyDetailTitle').textContent = session.task;
    const timeline = document.getElementById('historyTimeline'); timeline.replaceChildren();
    for (const event of session.events) {
      const item = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = event.type === 'action' ? event.source === 'recorded' ? 'Recorded action · result unverified' : event.step.verification === 'verified' ? 'Guided action · result verified' : event.step.verification === 'manual' ? 'Guided action · confirmed by you' : 'Guided action · result unverified' : event.type === 'advice' ? 'Suggested guidance' : event.type === 'outcome' ? `Guidance summary · ${this.statusLabel(event.status)}` : event.type === 'request' ? 'Your request' : event.type === 'page' ? 'Page visited' : 'Session update';
      const text = document.createElement('p'); text.textContent = event.text || event.step?.description || '';
      const context = document.createElement('small'); context.className = 'history-meta'; context.textContent = `${new Date(event.at).toLocaleString()}${event.url ? ` · ${event.url}` : ''}`;
      item.append(heading, text, context);
      const instructions = [...(event.instructions || []), ...(event.remainingActions || [])];
      if (instructions.length) {
        const ol = document.createElement('ol');
        for (const instruction of instructions) {
          const li = document.createElement('li'); li.textContent = typeof instruction === 'string' ? instruction : instruction.text;
          if (instruction.hint) { const hint = document.createElement('p'); hint.className = 'history-meta'; hint.textContent = instruction.hint; li.append(hint); }
          ol.append(li);
        }
        item.append(ol);
      }
      timeline.append(item);
    }
    document.getElementById('saveHistoryWalkthroughBtn').classList.toggle('hidden', !session.events.some(event => event.type === 'action'));
  }
}
globalThis.GuideMeHistoryUI = GuideMeHistoryUI;
