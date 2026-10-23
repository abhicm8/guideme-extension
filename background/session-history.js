// Durable user-visible history. Active tab bindings can be removed without deleting history.
const indexKey = 'guideme_history_index';
const keyFor = id => `guideme_session_${id}`;
const tabKey = tabId => `guideme_session_tab_${tabId}`;
export class SessionHistory {
  constructor(browser) { this.browser = browser; this.queue = Promise.resolve(); }
  write(operation) {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async get(id) { return id ? (await this.browser.storage.local.get([keyFor(id)]))[keyFor(id)] || null : null; }
  async list() { return (await this.browser.storage.local.get([indexKey]))[indexKey] || []; }
  async context(tabId) {
    const binding = (await this.browser.storage.local.get([tabKey(tabId)]))[tabKey(tabId)];
    return this.get(binding);
  }
  async persist(session, extra = {}) {
    const index = (await this.list()).filter(item => item.id !== session.id);
    const { id, task, startUrl, createdAt, updatedAt, status } = session;
    index.unshift({ id, task, startUrl, createdAt, updatedAt, status, actionCount: session.events.filter(event => event.type === 'action').length });
    index.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.browser.storage.local.set({ [keyFor(id)]: session, [indexKey]: index, ...extra });
  }
  start({ id, tabId, task, url }) {
    return this.write(async () => {
      if ((await this.browser.storage.local.get(['saveSessionHistory'])).saveSessionHistory === false) {
        await this.browser.storage.local.remove([tabKey(tabId)]);
        return null;
      }
      const now = Date.now();
      const session = { id, task, startUrl: url, createdAt: now, updatedAt: now, status: 'active', events: [
        { id: `${id}:request`, type: 'request', text: task, url, at: now }
      ] };
      await this.persist(session, { [tabKey(tabId)]: id });
      return session;
    });
  }
  bind(id, tabId) {
    return this.write(async () => {
      const { activeRecording } = await this.browser.storage.local.get(['activeRecording']);
      if (activeRecording?.isRecording && activeRecording.ownerTabId === tabId && activeRecording.sessionId !== id) throw new Error('Stop recording before opening a different session.');
      const session = await this.get(id);
      if (!session) throw new Error('This history session is no longer available.');
      await this.browser.storage.local.set({ [tabKey(tabId)]: id });
      return session;
    });
  }
  append(id, tabId, event) {
    return this.write(async () => {
      if ((await this.browser.storage.local.get(['saveSessionHistory'])).saveSessionHistory === false) return null;
      const current = await this.context(tabId);
      if (!current || current.id !== id) return null;
      if (!['advice', 'action', 'outcome', 'page', 'recording', 'paused'].includes(event.type)) throw new Error('Unknown history event.');
      const existing = current.events.findIndex(item => item.id === event.id);
      if (existing !== -1 && !(event.type === 'action' && event.source === 'recorded')) return current;
      const entry = { ...event, id: event.id || crypto.randomUUID(), at: event.at || Date.now() };
      if (existing === -1) current.events.push(entry);
      else current.events[existing] = entry;
      current.updatedAt = Date.now();
      if (entry.type === 'outcome') current.status = entry.status;
      else if (entry.type === 'paused' && current.status !== 'complete') current.status = 'paused';
      else if (entry.type === 'advice') current.status = entry.status || 'active';
      await this.persist(current);
      return current;
    });
  }
  advice(id, tabId, result, url) {
    return this.append(id, tabId, {
      id: crypto.randomUUID(), type: 'advice', url, status: result.status || 'next_step', text: result.summary || '',
      instructions: result.steps?.map(step => ({ text: step.description, hint: step.hint })) || [],
      remainingActions: result.remainingActions || []
    });
  }
  detach(tabId) { return this.write(() => this.browser.storage.local.remove([tabKey(tabId)])); }
  delete(id) {
    return this.write(async () => {
      const { activeRecording } = await this.browser.storage.local.get(['activeRecording']);
      if (activeRecording?.isRecording && activeRecording.sessionId === id) throw new Error('Stop recording before deleting this session.');
      await this.browser.storage.local.remove([keyFor(id)]);
      await this.browser.storage.local.set({ [indexKey]: (await this.list()).filter(item => item.id !== id) });
    });
  }
  clear() {
    return this.write(async () => {
      const { activeRecording } = await this.browser.storage.local.get(['activeRecording']);
      if (activeRecording?.isRecording && activeRecording.sessionId) throw new Error('Stop recording before clearing history.');
      const index = await this.list();
      await this.browser.storage.local.remove(index.map(item => keyFor(item.id)));
      await this.browser.storage.local.set({ [indexKey]: [] });
    });
  }
}

export function guidedSteps(session) {
  return session?.events.filter(event => event.type === 'action' && event.source === 'guided').map(event => event.step) || [];
}
