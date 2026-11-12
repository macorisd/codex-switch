'use strict';

// One lifecycle for all API keys. Hidden providers cannot start/continue requests.
class ApiSessions {
  constructor({ definitions, request, visible, post, input, apply, alerts, timers = globalThis }) {
    Object.assign(this, { definitions, request, visible, post, input, apply, alerts, timers });
    this.sessions = new Map(definitions.map(p => [p.id, { loading: true, valid: false, models: [] }]));
    this.pending = new Map(); this.controllers = new Map(); this.timer = null;
  }
  async publish(id) {
    if (this.visible(id)) await this.post({ type: 'apiState', provider: id, state: this.sessions.get(id) });
  }
  stop(id) { this.controllers.get(id)?.abort(); }
  reconcile() {
    for (const p of this.definitions) if (!this.visible(p.id)) this.stop(p.id);
    if ([...this.sessions.keys()].some(id => this.visible(id))) {
      if (!this.timer) this.timer = this.timers.setInterval(() => { void this.refreshAll(false); }, 60000);
    } else { this.timers.clearInterval(this.timer); this.timer = null; }
  }
  dispose() {
    for (const id of this.sessions.keys()) this.stop(id);
    this.timers.clearInterval(this.timer);
  }
  refreshAll(manual = true) {
    this.reconcile();
    return Promise.allSettled(this.definitions.filter(p => this.visible(p.id)).map(p => this.refresh(p.id, manual)));
  }
  task(id, work) {
    if (!this.visible(id)) return Promise.resolve();
    if (this.pending.has(id)) return this.pending.get(id);
    const controller = new AbortController(); this.controllers.set(id, controller);
    const state = this.sessions.get(id);
    const live = () => this.visible(id) && !controller.signal.aborted;
    const request = async (operation, extra = {}) => {
      if (!live()) throw new Error('Cancelled');
      const result = await this.request({ action: 'api', provider: id, operation, ...extra }, controller.signal);
      if (!live()) throw new Error('Cancelled');
      return result;
    };
    state.working = true;
    const pending = (async () => {
      await this.publish(id);
      try { await work({ state, request, live }); }
      catch {
        if (live()) { if (state.loading) state.valid = false; state.error = 'Operation failed. Check the key, endpoint, model access and connection.'; }
      } finally {
        state.working = false; state.loading = false;
        if (state.feedback) state.feedback.ok = !state.error;
        if (live()) await this.publish(id);
      }
    })().finally(() => { this.pending.delete(id); this.controllers.delete(id); });
    this.pending.set(id, pending); return pending;
  }
  async load(id, { state, request }, manual) {
    state.loading = true; await this.publish(id);
    const previouslyValid = state.valid;
    Object.assign(state, await request('status'));
    if (state.hasKey) {
      if (manual || !previouslyValid) {
        state.valid = false;
        Object.assign(state, await request('refresh'));
      }
      if (state.valid && this.definitions.find(p => p.id === id).usage) {
        try { state.balance = await request('balance'); state.balanceError = ''; }
        catch { state.balance = null; state.balanceError = 'Balance unavailable.'; }
        if (state.balance) this.alerts(id, state.balance);
      }
    } else { state.valid = false; state.balance = null; state.balanceError = ''; this.alerts(id, null); }
    state.error = '';
  }
  refresh(id, manual = false) {
    if (this.pending.has(id) && this.controllers.get(id)?.signal.aborted) {
      return this.pending.get(id).then(() => this.refresh(id, true));
    }
    return this.task(id, args => this.load(id, args, manual));
  }
  run(message) {
    const { provider: id, operation } = message;
    const p = this.definitions.find(p => p.id === id);
    if (!p || !this.visible(id) || this.pending.has(id)) return Promise.resolve();
    return this.task(id, async args => {
      const { state, request, live } = args;
      state.error = '';
      state.feedback = ['refresh', 'test'].includes(operation) ? { operation, origin: message.origin, ok: null, stamp: Date.now() } : null;
      if (operation === 'saveKey' || operation === 'endpoint') {
        const isKey = operation === 'saveKey';
        const value = await this.input(isKey
          ? { title: `${p.name} API key`, password: true, ignoreFocusOut: true, prompt: 'Stored securely for your OS user. Model tests are separate and may incur API charges.' }
          : { title: `${p.name} official API endpoint`, value: state.baseUrl || p.baseUrl, prompt: 'Use the official Responses endpoint for your region/plan. Alibaba PAYG needs its workspace endpoint.' });
        if (value === undefined || !live()) return;
        Object.assign(state, await request(operation, isKey ? { key: value } : { url: value }));
        this.alerts(id, null);
        state.valid = false; await this.load(id, args, true);
      } else if (operation === 'refresh') {
        if (!state.hasKey) { state.feedback = null; return; }
        state.valid = false; await this.load(id, args, true);
        if (!state.valid) state.feedback = null;
      } else if (operation === 'test' && state.hasKey && state.model) {
        state.tested = null;
        Object.assign(state, await request('test'));
      } else if (operation === 'select' && state.hasKey) {
        Object.assign(state, await request('select', { model: message.model, effort: message.effort || '' }));
      } else if (operation === 'apply' && state.valid) {
        await this.apply(() => request('apply'));
      } else return;
      state.error = '';
    });
  }
}
module.exports = { ApiSessions };
