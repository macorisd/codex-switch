'use strict';
const metrics = require('./media/usage-metrics');
class UsageStatus {
  constructor(vscode, providers, threshold) {
    Object.assign(this, { vscode, providers, threshold });
    this.timeZone = vscode.env?.remoteName ? 'UTC' : undefined;
    this.clientZoneKnown = !vscode.env?.remoteName;
    this.item = vscode.window.createStatusBarItem('codexSwitch.usage', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Codex Switch Usage'; this.item.command = 'codexSwitch.open';
    this.render(null, null);
  }
  setTimeZone(value) {
    if (typeof value !== 'string' || value.length > 100) return;
    try { new Intl.DateTimeFormat(undefined, { timeZone: value }); this.timeZone = value; this.clientZoneKnown = true; } catch {}
  }
  date(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium', timeZone: this.timeZone }).format(new Date(value))
      + (this.clientZoneKnown ? '' : ' UTC');
  }
  render(id, reading, now = Date.now()) {
    const provider = this.providers.find(p => p.id === id), valid = reading?.status === 'ready';
    const name = id === 'openai' ? 'Codex' : provider?.name || 'Codex Switch';
    const icon = provider ? `$(codex-switch-${id})` : '$(pulse)';
    this.item.text = `${icon} ${name} ${valid ? metrics.text(reading.balance, now) : '—'}`;
    const level = valid ? metrics.level(reading.balance, this.threshold(id)) : null;
    this.item.backgroundColor = level === 'zero' ? new this.vscode.ThemeColor('statusBarItem.errorBackground')
      : level === 'low' ? new this.vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.color = undefined;
    const lines = [provider ? `${provider.name}${reading?.account?.plan ? ` (${reading.account.plan} Plan)` : ''} — verified workspace default for new chats.`
      : 'This window has not confirmed a provider. Open Codex Switch for details.'];
    if (valid) {
      if (reading.balance.windows) for (const window of reading.balance.windows) lines.push(
        `${metrics.label(window)}: ${window.remaining.toFixed(1)}% remaining. ${window.resetsAt ? `Resets ${this.date(window.resetsAt * 1000)}` : 'Reset time unavailable.'}`);
      else {
        lines.push(`${metrics.amount(reading.balance)} remaining.`);
        if (reading.balance.periodEnd) lines.push(`Plan period ends ${this.date(reading.balance.periodEnd * 1000)}. Renewal is not assumed.`);
      }
    } else if (provider) lines.push(reading?.reason || 'Reading usage…');
    if (reading?.capturedAt) lines.push(`Last checked ${this.date(reading.capturedAt)}.`);
    if (!valid && reading?.lastGood) lines.push(`Previous reading (out of date): ${metrics.text(reading.lastGood.balance, now)}. Captured ${this.date(reading.lastGood.capturedAt)}.`);
    lines.push('Click to open Codex Switch.');
    this.item.tooltip = lines.join('\n');
    this.item.accessibilityInformation = { label: this.item.text.replace(/\$\([^)]+\)/g, '').trim() + '. ' + lines.join(' ') };
    this.item.show();
  }
  dispose() { this.item.dispose(); }
}
module.exports = { UsageStatus };
