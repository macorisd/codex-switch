'use strict';
// Shared by the extension host and webview so colors and warnings cannot diverge.
(function (root, create) {
  if (typeof module === 'object' && module.exports) module.exports = create();
  else root.BalanceAlerts = create();
})(typeof window === 'object' ? window : globalThis, () => {
  const threshold = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  function metric(balance) {
    if (Number.isFinite(balance?.total) && ['USD', 'CNY'].includes(balance.currency)) {
      return { value: balance.total, unit: balance.currency };
    }
    const remaining = (balance?.windows || []).map(w => w.remaining).filter(Number.isFinite);
    return remaining.length ? { value: Math.min(...remaining), unit: '%' } : null;
  }
  function level(balance, limit) {
    const reading = metric(balance);
    if (!reading) return null;
    if (!threshold(limit)) return 'ok';
    return reading.value <= 0 ? 'zero' : reading.value < limit ? 'low' : 'ok';
  }
  class Tracker {
    constructor() { this.previous = new Map(); }
    reset(id) { this.previous.delete(id); }
    observe(id, balance, limit) {
      const reading = metric(balance);
      if (!reading) return null;
      const next = { ...reading, threshold: threshold(limit), level: level(balance, limit) };
      const previous = this.previous.get(id);
      this.previous.set(id, next);
      if (!previous || previous.unit !== next.unit || previous.threshold !== next.threshold) return null;
      const downward = previous.level === 'ok' && next.level === 'low'
        || previous.level !== 'zero' && next.level === 'zero';
      return downward ? next : null;
    }
  }
  return { threshold, metric, level, Tracker };
});
