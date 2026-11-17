'use strict';
const metrics = require('./media/usage-metrics');

// One window-local cache and in-flight request per provider, shared by all views.
class UsageService {
  constructor({ load, demanded, changed = () => {}, now = Date.now, ttl = 60000 }) {
    Object.assign(this, { load, demanded, changed, now, ttl });
    this.entries = new Map(); this.pending = new Map(); this.epochs = new Map(); this.disposed = false;
  }
  get(id) { return this.entries.get(id); }
  invalidate(id) {
    this.epochs.set(id, (this.epochs.get(id) || 0) + 1);
    this.pending.get(id)?.controller.abort(); this.pending.delete(id);
    this.entries.delete(id); this.changed(id);
  }
  reconcile() {
    for (const [id, task] of this.pending) if (!this.demanded(id)) { task.controller.abort(); this.pending.delete(id); }
  }
  read(id, force = false) {
    if (this.disposed || !this.demanded(id)) return Promise.resolve(null);
    const cached = this.get(id);
    if (!force && cached && this.now() < cached.nextRead) return Promise.resolve(cached);
    if (this.pending.has(id)) return this.pending.get(id).promise;
    const controller = new AbortController(), epoch = this.epochs.get(id) || 0;
    const task = { controller };
    task.promise = (async () => {
      let result;
      try {
        const value = await this.load(id, controller.signal);
        const balance = metrics.normalize(value.balance);
        result = { balance, account: value.account, status: balance ? 'ready' : 'unavailable',
          reason: balance ? '' : value.reason || 'Usage is unavailable.', retry: value.retry === true };
      } catch {
        result = { balance: null, status: 'unavailable', reason: 'Usage is temporarily unavailable.', retry: true };
      }
      if (this.disposed || controller.signal.aborted || !this.demanded(id) || epoch !== (this.epochs.get(id) || 0)) return null;
      const failures = result.retry ? Math.min(3, (cached?.failures || 0) + 1) : 0;
      const capturedAt = this.now();
      const next = { ...result, capturedAt, failures, nextRead: capturedAt + this.ttl * (2 ** failures),
        lastGood: result.balance ? { balance: result.balance, capturedAt } : cached?.lastGood };
      this.entries.set(id, next); this.changed(id); return next;
    })().finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); });
    this.pending.set(id, task); return task.promise;
  }
  dispose() {
    this.disposed = true;
    for (const task of this.pending.values()) task.controller.abort();
    this.pending.clear(); this.entries.clear();
  }
}
module.exports = { UsageService };
