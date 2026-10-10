import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { sha256, secretBytes, hexBytes, toBase64, fromBase64 } from './core.js';

export { getPublicKey };
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
export function validateRelays(values) {
  const urls = [...new Set(values.map(s => s.trim()).filter(Boolean))];
  if (!urls.length || urls.length > 6) throw Error('Choose between 1 and 6 relay addresses.');
  for (const value of urls) {
    const url = new URL(value);
    if ((url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.hash) throw Error('Use secure wss:// relay addresses.');
  }
  return urls;
}
export async function roomCrypto(secret) {
  const channel = await sha256(`open-poker:channel:v1:${secret}`);
  const key = await crypto.subtle.importKey('raw', secretBytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const additionalData = new TextEncoder().encode(`open-poker:v1:${channel}`);
  return {
    channel,
    async encrypt(message) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, new TextEncoder().encode(JSON.stringify(message)));
      return `1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
    },
    async decrypt(content) {
      const [v, iv, body] = content.split('.');
      if (v !== '1' || !iv || !body) throw Error('Unknown encrypted message format.');
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData }, key, fromBase64(body))));
    },
  };
}

export class RelayTransport {
  constructor({ secret, privateKey, relays, onMessage, onStatus, onReady }) {
    Object.assign(this, { secret, privateKey: hexBytes(privateKey), relays: validateRelays(relays), onMessage, onStatus, onReady });
    this.sockets = new Map(); this.seen = new Set(); this.stopped = false;
    this.receiveQueue = Promise.resolve();
  }
  async start() {
    this.cipher = await roomCrypto(this.secret);
    for (const url of this.relays) this.connect(url);
  }
  report() { this.onStatus([...this.sockets.values()].map(s => ({ url: s.url, state: s.state, detail: s.detail }))); }
  connect(url, retry = 0) {
    if (this.stopped) return;
    const item = { url, state: 'connecting', detail: '', socket: null, timer: null, watchdog: null };
    this.sockets.set(url, item); this.report();
    const socket = item.socket = new WebSocket(url);
    item.watchdog = setTimeout(() => { item.detail = 'Connection timed out'; socket.close(); }, 12_000);
    socket.onopen = () => {
      clearTimeout(item.watchdog);
      item.state = 'connected'; item.detail = 'Checking publish access';
      socket.send(JSON.stringify(['REQ', 'poker', { kinds: [21717], '#h': [this.cipher.channel], limit: 0 }]));
      this.report(); this.onReady();
    };
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string' || data.length > 180_000) return;
      let frame; try { frame = JSON.parse(data); } catch { return; }
      if (!Array.isArray(frame)) return;
      if (frame[0] === 'OK') {
        item.state = frame[2] ? 'ready' : 'rejected'; item.detail = frame[2] ? 'Sending & receiving' : String(frame[3] || 'Publishing rejected').slice(0, 140); this.report();
      }
      if (frame[0] === 'AUTH' || frame[0] === 'CLOSED') {
        item.state = 'rejected'; item.detail = frame[0] === 'AUTH' ? 'This relay requires authentication' : String(frame[2] || 'Subscription closed').slice(0, 140); this.report();
      }
      if (frame[0] !== 'EVENT' || frame[1] !== 'poker') return;
      const event = frame[2];
      if (!event || event.kind !== 21717 || typeof event.content !== 'string' || event.content.length > 160_000 || !Array.isArray(event.tags) || !event.tags.some(t => t[0] === 'h' && t[1] === this.cipher.channel) || Math.abs(Date.now() / 1000 - event.created_at) > 300 || this.seen.has(event.id)) return;
      // Verify before deduplication, so an invalid copy cannot suppress a valid one.
      try { if (!verifyEvent(event)) return; } catch { return; }
      this.seen.add(event.id); if (this.seen.size > 2500) this.seen.delete(this.seen.values().next().value);
      this.receiveQueue = this.receiveQueue.then(async () => {
        const message = await this.cipher.decrypt(event.content);
        await this.onMessage(event.pubkey, message);
      }).catch(() => { /* Foreign or malformed ciphertext is not a room message. */ });
    };
    socket.onerror = () => { item.detail = 'Connection failed or blocked'; };
    socket.onclose = () => {
      clearTimeout(item.watchdog);
      if (this.stopped) return;
      item.state = 'offline'; this.report();
      item.timer = setTimeout(() => this.connect(url, retry + 1), Math.min(30_000, 1500 * 2 ** Math.min(retry, 4)) + Math.random() * 1000);
    };
  }
  async send(message) {
    if (this.stopped || !this.cipher) return;
    const event = finalizeEvent({ kind: 21717, created_at: Math.floor(Date.now() / 1000), tags: [['h', this.cipher.channel]], content: await this.cipher.encrypt(message) }, this.privateKey);
    for (const item of this.sockets.values()) if (item.socket.readyState === WebSocket.OPEN) item.socket.send(JSON.stringify(['EVENT', event]));
  }
  close() {
    this.stopped = true;
    for (const item of this.sockets.values()) { clearTimeout(item.timer); clearTimeout(item.watchdog); item.socket.close(); }
  }
}
