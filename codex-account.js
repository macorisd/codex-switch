'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function executable(vscode) {
  const extension = vscode.extensions?.getExtension('openai.chatgpt');
  if (extension) {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const candidate = path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function normalize(account, response) {
  const configured = ['chatgpt', 'chatgptAuthTokens'].includes(account?.type);
  const fallback = response?.rateLimits;
  const bucket = response?.rateLimitsByLimitId?.codex
    ?? (fallback && (!fallback.limitId || fallback.limitId === 'codex') ? fallback : null);
  const windows = [bucket?.primary, bucket?.secondary];
  const window = duration => {
    const value = windows.find(item => item?.windowDurationMins === duration);
    if (!value) return null;
    return {
      remaining: typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent)
        ? Math.max(0, Math.min(100, 100 - value.usedPercent)) : null,
      resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 ? value.resetsAt : null,
    };
  };
  const count = response?.rateLimitResetCredits?.availableCount;
  const plans = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', business: 'Business', team: 'Business' };
  const planType = account?.planType || bucket?.planType;
  const plan = configured && Object.hasOwn(plans, planType) ? plans[planType] : null;
  return {
    configured, plan, fiveHour: configured ? window(300) : null,
    weekly: configured ? window(10080) : null,
    bankedResets: configured && Number.isSafeInteger(count) && count >= 0 ? count : null,
    usageAvailable: configured && Boolean(response),
  };
}

// Only these read methods are sent. Never forward upstream errors or account data.
function readAccount(command, { spawnProcess = spawn, timeoutMs = 25000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Codex account unavailable.'));
    let child;
    let settled = false;
    let buffer = '';
    let total = 0;
    let account;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child?.stdin.destroy();
      child?.kill();
      if (error) reject(new Error('Codex account unavailable.'));
      else resolve(result);
    };
    const abort = () => finish(true);
    const timer = setTimeout(() => account ? finish(false, normalize(account)) : finish(true), timeoutMs);
    const send = (id, method, params) => {
      child.stdin.write(JSON.stringify({ ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }) + '\n');
    };
    try {
      // Per-process override lets a saved ChatGPT account be read while DeepSeek
      // is selected, without writing config.toml or changing the selected provider.
      child = spawnProcess(command, ['app-server', '-c', 'model_provider="openai"'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(true));
      child.on('close', () => finish(true));
      child.stderr.resume();
      child.stdout.setEncoding?.('utf8');
      child.stdin.on('error', () => finish(true));
      child.stdout.on('data', chunk => {
        if (settled) return;
        total += chunk.length;
        if (total > 2_000_000) return finish(true);
        buffer += chunk.toString();
        let newline;
        while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { return finish(true); }
          if (message.id === 1) {
            if (message.error) return finish(true);
            send(null, 'initialized');
            send(2, 'account/read', { refreshToken: false });
          } else if (message.id === 2) {
            if (message.error || !message.result || !Object.hasOwn(message.result, 'account')) return finish(true);
            account = message.result.account;
            if (!['chatgpt', 'chatgptAuthTokens'].includes(account?.type)) return finish(false, normalize(account));
            send(3, 'account/rateLimits/read');
          } else if (message.id === 3) {
            finish(false, normalize(account, message.error ? null : message.result));
          }
        }
      });
      send(1, 'initialize', { clientInfo: { name: 'codex_switch', version: '0.3.0' }, capabilities: { experimentalApi: true } });
    } catch { finish(true); }
  });
}

module.exports = { executable, normalize, readAccount };
