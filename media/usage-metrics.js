'use strict';
(function(root, create) {
  if (typeof module === 'object' && module.exports) module.exports = create();
  else root.UsageMetrics = create();
})(typeof window === 'object' ? window : globalThis, () => {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function normalize(balance) {
    if (finite(balance?.total) && ['USD', 'CNY'].includes(balance.currency))
      return { total: balance.total, currency: balance.currency };
    if (finite(balance?.total) && balance.total >= 0 && balance.unit === 'Credits')
      return { total: balance.total, unit: 'Credits', periodEnd: balance.periodEnd, periodStart: balance.periodStart, autoRenew: balance.autoRenew === true };
    const windows = (Array.isArray(balance?.windows) ? balance.windows : []).filter(w =>
      w && finite(w.remaining) && w.remaining >= 0 && w.remaining <= 1000).map((w, i) => ({
      id: String(w.id ?? i), label: typeof w.label === 'string' ? w.label.slice(0, 80) : 'Usage',
      durationMins: finite(w.durationMins) && w.durationMins > 0 ? w.durationMins : null,
      remaining: w.remaining, resetsAt: finite(w.resetsAt) && w.resetsAt > 0 && w.resetsAt <= 253402300799 ? w.resetsAt : null,
    })).sort((a, b) => (a.durationMins ?? Infinity) - (b.durationMins ?? Infinity));
    return windows.length ? { windows } : null;
  }
  function label(window) {
    const minutes = window.durationMins;
    for (const [duration, name] of [[300, '5h'], [1440, 'Day'], [10080, 'Week'], [43200, 'Month'], [525600, 'Year']])
      if (finite(minutes) && Math.abs(minutes - duration) <= duration * .05) return name;
    if (finite(minutes)) return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.round(minutes)}m`;
    return /week/i.test(window.label || '') ? 'Week' : 'Usage';
  }
  function duration(seconds) {
    if (!finite(seconds)) return 'unknown';
    if (seconds <= 0) return '0m';
    const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  function amount(balance) {
    if (!finite(balance?.total)) return '';
    if (balance.unit === 'Credits') return `${balance.total.toLocaleString('en-US', { maximumFractionDigits: 0 })} Credits`;
    if (!['USD', 'CNY'].includes(balance.currency)) return '';
    const value = balance.total !== 0 && Math.abs(balance.total) < .01 ? balance.total.toPrecision(2)
      : balance.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${balance.currency} ${value}`;
  }
  function level(balance, limit = 0) {
    if (balance?.windows?.length) {
      const values = balance.windows.map(w => w.remaining).filter(finite);
      if (!values.length) return null;
      return Math.min(...values) <= 10 ? 'zero' : Math.min(...values) <= 25 ? 'low' : 'ok';
    }
    if (!amount(balance)) return null;
    return !finite(limit) || limit <= 0 ? 'ok' : balance.total <= 0 ? 'zero' : balance.total < limit ? 'low' : 'ok';
  }
  function text(balance, now = Date.now()) {
    return balance?.windows?.length ? balance.windows.map(w =>
      `${label(w)} ${Math.round(w.remaining)}% · ${duration(w.resetsAt ? Math.max(0, w.resetsAt - now / 1000) : NaN)}`).join(' | ') : amount(balance);
  }
  return { normalize, label, duration, amount, level, text };
});
