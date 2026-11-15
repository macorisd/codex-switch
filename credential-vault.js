'use strict';
const net = require('node:net');
const crypto = require('node:crypto');
const PREFIX = 'api-key/v1/';
const LEGACY = 'native-api-key/v1/';

class CredentialVault {
  constructor(context, providers, remote = false) {
    this.secrets = context.secrets;
    this.providers = new Set(providers.map(p => p.id));
    this.token = crypto.randomBytes(32).toString('hex');
    this.remote = remote;
    this.enabled = Boolean(this.secrets);
    this.clients = new Set();
    this.queue = Promise.resolve();
    this.ready = this.enabled ? new Promise((resolve, reject) => {
      this.server = net.createServer(socket => this.accept(socket));
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.connection = JSON.stringify({ port: this.server.address().port, token: this.token, remote });
        resolve();
      });
    }) : Promise.resolve();
    this.ready = this.ready.catch(() => { this.enabled = false; });
  }
  provider(key) {
    for (const prefix of [PREFIX, LEGACY]) {
      if (key.startsWith(prefix) && this.providers.has(key.slice(prefix.length))) return key.slice(prefix.length);
    }
  }
  async entry(provider) {
    const explicit = await this.secrets.get(PREFIX + provider);
    const raw = explicit === undefined ? await this.secrets.get(LEGACY + provider) : explicit;
    if (raw === undefined) return null;
    const value = JSON.parse(raw);
    if (!value || (value.key !== null && typeof value.key !== 'string') || typeof value.revision !== 'string') throw Error('Invalid credential');
    return value;
  }
  async handle(request) {
    const token = Buffer.from(typeof request.token === 'string' ? request.token : '');
    const expected = Buffer.from(this.token);
    if (token.length !== expected.length || !crypto.timingSafeEqual(token, expected) || !this.providers.has(request.provider)) throw Error('Denied');
    const { operation, provider, value } = request;
    if (operation === 'get' || operation === 'status') {
      const entry = await this.entry(provider);
      return operation === 'get' ? { value: entry?.key ?? null } :
        { known: Boolean(entry), hasKey: Boolean(entry?.key), revision: entry?.revision ?? null };
    }
    if (!['store', 'delete', 'migrate'].includes(operation)) throw Error('Denied');
    if (operation !== 'delete' && (typeof value !== 'string' || value.length < 8 || value.length > 8192 || /\s/.test(value))) throw Error('Invalid credential');
    if (operation === 'migrate' && await this.entry(provider)) return {};
    await this.secrets.store((operation === 'migrate' ? LEGACY : PREFIX) + provider,
      JSON.stringify({ key: operation === 'delete' ? null : value, revision: crypto.randomBytes(16).toString('hex') }));
    return {};
  }
  accept(socket) {
    this.clients.add(socket);
    socket.setTimeout(55000, () => socket.destroy());
    socket.once('close', () => this.clients.delete(socket));
    socket.on('error', () => {});
    let buffer = '', received = false;
    socket.on('data', chunk => {
      if (received) return socket.destroy();
      buffer += chunk.toString('utf8');
      if (buffer.length > 16384) return socket.destroy();
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      received = true;
      const work = async () => {
        try { socket.end(JSON.stringify({ ok: true, ...await this.handle(JSON.parse(buffer.slice(0, index))) }) + '\n'); }
        catch { socket.end('{"ok":false,"code":"credential-store-unavailable"}\n'); }
      };
      // Serialize migration/key edits in this host; explicit entries always
      // supersede the separate legacy namespace across concurrent windows.
      this.queue = this.queue.then(work, work);
    });
  }
  async close() {
    await this.ready.catch(() => {});
    for (const socket of this.clients) socket.destroy();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
  }
}
module.exports = { CredentialVault };
