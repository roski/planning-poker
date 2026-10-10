export const PRESENCE_TIMEOUT = 120_000;
export const DECKS = [
  { id: 'fibonacci', name: 'Fibonacci', cards: ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'] },
  { id: 'modified', name: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'] },
  { id: 'powers', name: 'Powers of 2', cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'] },
  { id: 'threes', name: 'Multiples of 3', cards: ['0', '3', '6', '9', '12', '15', '18', '21', '24', '27', '30', '?', '☕'] },
  { id: 'tshirts', name: 'T-shirt sizes', cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'] },
  { id: 'hours', name: 'Hours', cards: ['1', '2', '4', '8', '12', '16', '24', '40', '?', '☕'] },
];
export const randomHex = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
export const hexBytes = hex => Uint8Array.from(hex.match(/.{2}/g), x => parseInt(x, 16));
export const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
export const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const newSecret = () => toBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const secretBytes = secret => fromBase64(secret.replaceAll('-', '+').replaceAll('_', '/') + '=');
export const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
export const commitment = (round, pubkey, value, salt) => sha256(JSON.stringify(['open-poker-v1', round, pubkey, value, salt]));
export function parseInvite(input) {
  let text = input.trim();
  if (text.includes('#')) text = new URLSearchParams(text.split('#')[1]).get('room') || '';
  text = text.replace(/^room=/, '');
  const [secret, host, ...extra] = text.split('.');
  if (extra.length || !/^[A-Za-z0-9_-]{43}$/.test(secret || '') || !/^[a-f0-9]{64}$/.test(host || '') || secretBytes(secret).length !== 32) throw Error('Paste the complete room link or invitation code.');
  return { secret, host, token: `${secret}.${host}` };
}
export function validateDeck(deck) {
  if (!deck || typeof deck.name !== 'string' || !deck.name.trim() || deck.name.length > 40 || !Array.isArray(deck.cards) || deck.cards.length < 2 || deck.cards.length > 24 || new Set(deck.cards).size !== deck.cards.length || deck.cards.some(c => typeof c !== 'string' || !c.trim() || c.length > 8)) throw Error('A deck needs a name and 2–24 different cards, up to 8 characters each.');
  const cards = deck.cards.map(c => c.trim());
  if (new Set(cards).size !== cards.length) throw Error('Each card must have a different value.');
  return { id: typeof deck.id === 'string' ? deck.id.slice(0, 64) : randomHex(8), name: deck.name.trim(), cards };
}
export function summary(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  const numbers = values.map(v => v === '½' ? .5 : (/^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN)).filter(Number.isFinite);
  return { counts, total: values.length, average: numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length * 10) / 10 : null, consensus: values.length > 1 && Object.keys(counts).length === 1 };
}
export const newRound = () => ({ id: randomHex(), phase: 'voting', commits: {}, reveals: {}, names: {} });
// Extract a readable reference locally; never fetch private tracker pages.
export function parseTask(input) {
  if (input && typeof input === 'object') {
    if (!Object.hasOwn(input, 'url')) return parseTask(input.title);
    return { title: String(input.title || ''), url: input.url ? parseTask(input.url).url : null };
  }
  const text = String(input).trim();
  if (/^#?\d+$/.test(text)) return { title: `#${text.replace(/^#/, '')}`, url: null };
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return { title: text, url: null };
    const path = decodeURIComponent(url.pathname);
    const linear = url.hostname === 'linear.app' && path.match(/\/issue\/([a-z][a-z0-9_]*-\d+)\/([^/]+)/i);
    if (linear) return { title: linear[2].replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), url: url.href };
    const github = url.hostname === 'github.com' && path.match(/^\/[^/]+\/([^/]+)\/issues\/(\d+)/);
    if (github) return { title: `${github[1]} #${github[2]}`, url: url.href };
    const selected = url.searchParams.get('selectedIssue');
    if (/^[a-z][a-z0-9_]*-\d+$/i.test(selected || '')) return { title: selected, url: url.href };
    const ticket = path.match(/(?:^|\/)([a-z][a-z0-9_]*-\d+)(?:\/|$)/i)?.[1];
    const numeric = path.match(/\/(?:edit|issues|issue|pull|workitems|tickets)\/(\d+)(?:\/|$)/i)?.[1]
      || ['workItemId', 'workitem', 'selectedWorkItem', 'id'].map(k => url.searchParams.get(k)).find(v => /^\d+$/.test(v || ''))
      || path.match(/\/(\d+)\/?$/)?.[1];
    return { title: ticket || (numeric ? `#${numeric}` : text), url: url.href };
  } catch { return { title: text, url: null }; }
}
export function taskInput(input) {
  const item = typeof input === 'string' ? parseTask(input) : input;
  if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) throw Error('Use a title of 1–500 characters.');
  const url = item.url ? parseTask(item.url).url : null;
  if (item.url && (typeof item.url !== 'string' || item.url.length > 2000 || !url)) throw Error('Use a valid HTTP or HTTPS task link.');
  return { title: item.title.trim(), url };
}
export function splitTaskList(text, separator = 'auto') {
  if (separator === 'auto') separator = /[\r\n]/.test(text.trim()) ? 'lines' : 'commas';
  if (separator === 'lines') return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const result = []; let token = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { token += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === '\n' || (c === ',' && (!/^https?:\/\//i.test(token.trim()) || /^\s|^https?:\/\//i.test(text.slice(i + 1)))))) {
      if (token.trim()) result.push(token.trim()); token = '';
    } else token += c;
  }
  if (token.trim()) result.push(token.trim());
  return result;
}
const safeName = name => typeof name === 'string' && name.trim() && name.length <= 32;
const own = (object, key) => Object.hasOwn(object, key);

// One signed coordinator serializes room changes; every participant can request
// reveal/reset/tasks. Only the creator's signature can publish authoritative state.
export class RoomEngine {
  constructor({ me, host, send, onChange = () => {}, onError = () => {}, saved = null, onSave = () => {} }) {
    Object.assign(this, { me, host, send, onChange, onError, onSave });
    this.state = saved?.state || null;
    this.ballot = saved?.ballot || null;
    this.ballots = saved?.ballots || (this.ballot ? { [this.ballot.hash]: this.ballot } : {});
    this.lastHost = Date.now();
    this.lastSeen = new Map(Object.entries(this.state?.members || {}).filter(([, m]) => m.online && !m.removed).map(([pk]) => [pk, Date.now()]));
    this.pending = new Map();
    this.processed = new Map(saved?.processed || []);
    this.queue = Promise.resolve();
    this.closed = false;
  }
  get isHost() { return this.me === this.host; }
  create(name, deck, memberName) {
    const title = name.trim();
    this.state = { v: 1, rev: 1, name: title || 'Room', autoName: !title, createdAt: Date.now(), deck: validateDeck(deck), tasks: [], activeTask: null, members: { [this.me]: { name: memberName, observer: false, online: true } }, round: newRound() };
    this.changed();
  }
  save() { this.onSave({ state: this.state, ballot: this.ballot, ballots: this.ballots, processed: [...this.processed] }); }
  changed() { this.save(); this.onChange(this.state); }
  get confirmedBallot() {
    const round = this.state?.round;
    const b = this.ballots[round?.commits[this.me]];
    return b?.round === round?.id ? b : null;
  }
  async publish() { if (this.state && this.isHost) await this.send({ type: 'state', state: this.state }); }
  async tick() {
    if (!this.state || this.closed || this.state.members[this.me]?.removed) return;
    if (this.isHost) {
      let changed = false;
      for (const [pk, m] of Object.entries(this.state.members)) {
        const alive = !m.removed && (pk === this.me || Date.now() - (this.lastSeen.get(pk) || 0) < PRESENCE_TIMEOUT);
        if (m.online !== alive) { m.online = alive; changed = true; }
      }
      if (changed) { this.state.rev++; this.changed(); }
      await this.publish();
    } else await this.send({ type: 'ping' });
  }
  receive(author, message) {
    this.queue = this.queue.then(() => this.handle(author, message)).catch(e => this.onError(e.message));
    return this.queue;
  }
  async handle(author, message) {
    if (this.closed || !message || typeof message !== 'object') return;
    if (message.type === 'ack' && author === this.host && message.to === this.me) {
      const p = this.pending.get(message.id);
      if (p) { clearInterval(p.timer); this.pending.delete(message.id); message.error ? p.reject(Error(message.error)) : p.resolve(); }
      return;
    }
    if (message.type === 'state' && author === this.host && !this.isHost) {
      const state = message.state;
      if (!state || state.v !== 1 || !Number.isSafeInteger(state.rev) || state.rev < 1 || !state.round || !state.members || !Array.isArray(state.tasks) || state.tasks.length > 100 || Object.keys(state.members).length > 50) return;
      validateDeck(state.deck);
      this.lastHost = Date.now();
      if (!this.state || state.rev >= this.state.rev) {
        this.state = state;
        this.changed();
        this.maybeReveal();
      }
      return;
    }
    if (!this.isHost || !this.state) return;
    if (own(this.state.members, author) && !this.state.members[author].removed) this.lastSeen.set(author, Date.now());
    if (message.type === 'ping') return;
    if (message.type !== 'request' || typeof message.id !== 'string' || !/^[a-f0-9]{32}$/.test(message.id)) return;
    const cacheKey = `${author}:${message.id}`;
    if (this.processed.has(cacheKey)) {
      await this.send(this.processed.get(cacheKey)); return;
    }
    const response = { type: 'ack', to: author, id: message.id };
    try { await this.apply(author, message); }
    catch (error) { response.error = error.message; }
    this.processed.set(cacheKey, response);
    if (this.processed.size > 1000) this.processed.delete(this.processed.keys().next().value);
    this.save();
    await this.publish();
    await this.send(response);
    if (author === this.me) await this.handle(this.host, response);
    this.maybeReveal();
  }
  async apply(author, message) {
    const s = this.state, r = s.round, data = message.data || {};
    if (s.members[author]?.removed && message.action !== 'join') throw Error('The room creator removed you from this room.');
    if (message.action === 'join') {
      if (!safeName(data.name)) throw Error('Use a name of 1–32 characters.');
      if (!own(s.members, author) && Object.keys(s.members).length >= 50) throw Error('This room already has 50 participants.');
      const previous = s.members[author];
      s.members[author] = { name: data.name.trim(), observer: previous?.removed ? !!data.observer : previous?.observer ?? !!data.observer, online: true };
      this.lastSeen.set(author, Date.now());
    } else {
      const member = s.members[author];
      if (!member) throw Error('Join the room first.');
      if (!['leave', 'rename', 'kick'].includes(message.action) && message.round !== r.id) throw Error('The round changed. Please try again.');
      switch (message.action) {
        case 'commit':
          if (r.phase !== 'voting' || member.observer) throw Error('You cannot vote in this round.');
          if (data.hash !== null && !/^[a-f0-9]{64}$/.test(data.hash)) throw Error('Invalid vote commitment.');
          if (data.hash === null) delete r.commits[author]; else r.commits[author] = data.hash;
          break;
        case 'reveal':
          if (r.phase !== 'voting') throw Error('Cards are already revealed.');
          if (!Object.keys(r.commits).length) throw Error('Choose at least one card first.');
          r.phase = 'revealed';
          r.names = Object.fromEntries(Object.keys(r.commits).map(pk => [pk, s.members[pk]?.name || 'Participant']));
          break;
        case 'open':
          if (r.phase !== 'revealed' || !own(r.commits, author)) throw Error('There is no vote to reveal.');
          if (!s.deck.cards.includes(data.value) || !/^[a-f0-9]{64}$/.test(data.salt || '') || await commitment(r.id, author, data.value, data.salt) !== r.commits[author]) throw Error('The vote does not match its commitment.');
          r.reveals[author] = { value: data.value, salt: data.salt };
          if (s.activeTask) s.tasks.find(t => t.id === s.activeTask).result = summary(Object.values(r.reveals).map(v => v.value)).average;
          break;
        case 'reset':
          s.round = newRound(); break;
        case 'role':
          if (r.phase !== 'voting') throw Error('Change your role in the next round.');
          member.observer = !!data.observer; delete r.commits[author]; break;
        case 'tasks': {
          const source = data.items ?? data.titles;
          if (!Array.isArray(source) || !source.length || source.length + s.tasks.length > 100) throw Error('Use up to 100 tasks per room.');
          const items = source.map(taskInput);
          const selectFirst = !s.tasks.length && !s.activeTask && r.phase === 'voting' && !Object.keys(r.commits).length;
          s.tasks.push(...items.map(item => ({ id: randomHex(8), ...item, result: null })));
          if (selectFirst) s.activeTask = s.tasks[0].id;
          break;
        }
        case 'edit-task': {
          const task = s.tasks.find(t => t.id === data.id);
          if (!task) throw Error('Task not found.');
          Object.assign(task, taskInput(data.item)); break;
        }
        case 'select':
          if (data.id !== null && !s.tasks.some(t => t.id === data.id)) throw Error('Task not found.');
          s.activeTask = data.id; s.round = newRound(); break;
        case 'delete-task':
          if (data.id === s.activeTask) throw Error('Switch to another task before removing this one.');
          s.tasks = s.tasks.filter(t => t.id !== data.id); break;
        case 'deck':
          s.deck = validateDeck(data.deck); s.round = newRound(); break;
        case 'rename':
          if (!safeName(data.name)) throw Error('Use a name of 1–32 characters.');
          member.name = data.name.trim(); break;
        case 'kick': {
          if (author !== this.host) throw Error('Only the room creator can remove participants.');
          if (data.pk === this.host) throw Error('The creator cannot be removed.');
          const target = s.members[data.pk];
          if (!target || target.removed) throw Error('Participant not found.');
          target.removed = true; target.online = false; this.lastSeen.delete(data.pk);
          delete r.commits[data.pk]; delete r.reveals[data.pk]; delete r.names[data.pk];
          if (r.phase === 'revealed' && s.activeTask) s.tasks.find(t => t.id === s.activeTask).result = summary(Object.values(r.reveals).map(v => v.value)).average;
          break;
        }
        case 'leave':
          member.online = false; this.lastSeen.delete(author);
          if (r.phase === 'voting') delete r.commits[author];
          break;
        default: throw Error('Unknown room action.');
      }
    }
    s.rev++;
    this.changed();
  }
  request(action, data = {}) {
    if (this.closed) return Promise.reject(Error('Room is closed.'));
    const message = { type: 'request', id: randomHex(), action, data, round: this.state?.round.id };
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        if (++attempts > 7) {
          clearInterval(p.timer); this.pending.delete(message.id);
          reject(Error('No response from the room creator. Check the connection and try again.')); return;
        }
        if (this.isHost) this.receive(this.me, message);
        else this.send(message).catch(e => this.onError(e.message));
      };
      const p = { resolve, reject, timer: setInterval(attempt, 2000) };
      this.pending.set(message.id, p); attempt();
    });
  }
  async vote(value) {
    if (!this.state) throw Error('Wait for the room to connect.');
    if (value === null) { await this.request('commit', { hash: null }); this.ballot = null; this.changed(); return; }
    if (!this.state.deck.cards.includes(value)) throw Error('Choose a card from this deck.');
    const ballot = { round: this.state.round.id, value, salt: randomHex(32) };
    ballot.hash = await commitment(ballot.round, this.me, value, ballot.salt);
    // Keep pending secret through refresh, but show it as confirmed only after the
    // coordinator includes this hash in its snapshot.
    this.ballots = Object.fromEntries(Object.entries(this.ballots).filter(([, b]) => b.round === ballot.round));
    this.ballots[ballot.hash] = ballot;
    this.ballot = ballot; this.changed();
    await this.request('commit', { hash: ballot.hash });
    this.changed();
    this.maybeReveal();
  }
  maybeReveal() {
    const r = this.state?.round, b = this.confirmedBallot;
    if (!r || !b || r.phase !== 'revealed' || r.id !== b.round || r.commits[this.me] !== b.hash || r.reveals[this.me] || this.opening === r.id) return;
    this.opening = r.id;
    this.request('open', { value: b.value, salt: b.salt }).catch(e => this.onError(e.message)).finally(() => { this.opening = null; });
  }
  close() {
    this.closed = true;
    for (const p of this.pending.values()) { clearInterval(p.timer); p.reject(Error('You left the room.')); }
    this.pending.clear();
  }
}

// Consume completed entries while preserving unfinished or invalid input for editing.
export function consumeCardInput(existing, input, commitTail = false) {
  const values = [...existing];
  const parts = input.split(/[,;\n]/);
  const tail = commitTail ? '' : parts.pop().trimStart();
  const pending = [];
  let error = '';
  for (const raw of parts) {
    const value = raw.trim();
    if (!value || values.includes(value)) continue;
    if (value.length > 8 || values.length >= 24) {
      pending.push(value);
      error = value.length > 8 ? 'Use no more than 8 characters per card.' : 'Use up to 24 cards.';
    } else values.push(value);
  }
  return { values, remainder: [...pending, ...(tail ? [tail] : [])].join(', ') + (pending.length && !tail ? ',' : ''), error };
}


// Membership order is shared in snapshots; offline members keep their slot.
export function memberColor(members, publicKey) {
  const index = Math.max(0, Object.keys(members).indexOf(publicKey));
  const palette = ['#087f78', '#4267b2', '#a83e70', '#99601e', '#7252a3', '#367b44', '#b44343', '#347a95', '#975039', '#806529', '#9a4395', '#546699'];
  return palette[index] ?? `hsl(${((index - palette.length) * 137.508 + 15).toFixed(2)} 48% 36%)`;
}

export function roomDisplayName(room, locales, timeZone) {
  if (room.autoName !== true || !Number.isFinite(room.createdAt) || Math.abs(room.createdAt) > 8.64e15) return room.name;
  const date = new Intl.DateTimeFormat(locales, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(room.createdAt);
  const time = new Intl.DateTimeFormat(locales, { hour: 'numeric', minute: '2-digit', timeZone }).format(room.createdAt);
  return `Room ${date} · ${time}`;
}
