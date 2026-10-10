import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DECKS, RoomEngine, randomHex, newSecret, parseInvite, commitment, summary, validateDeck } from '../src/core.js';
import { roomCrypto, validateRelays } from '../src/transport.js';

const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } throw Error('Condition did not become true'); };
function setup(t) {
  const hostKey = randomHex(32), peers = new Map(), log = [], errors = [];
  const add = (pk = randomHex(32), saved = null) => {
    const e = new RoomEngine({ me: pk, host: hostKey, saved, onError: error => errors.push(error), send: async message => {
      log.push({ author: pk, message: structuredClone(message) });
      for (const [id, peer] of peers) if (id !== pk) queueMicrotask(() => peer.receive(pk, structuredClone(message)));
    } });
    peers.set(pk, e); return e;
  };
  const host = add(hostKey); host.create('Sprint', DECKS[0], 'Alice');
  t.after(() => { for (const peer of peers.values()) peer.close(); });
  return { host, add, peers, log, errors };
}
test('invitation contains a 256-bit secret and an independently authenticated host key', () => {
  const secret = newSecret(), host = randomHex(32), token = `${secret}.${host}`;
  assert.equal(parseInvite(`https://example.com/poker/#room=${token}`).token, token);
  assert.equal(parseInvite(token).secret.length, 43);
  assert.throws(() => parseInvite('123456'));
  assert.throws(() => parseInvite(`${token}.extra`));
});
test('AES-GCM hides contents, uses fresh nonces, rejects tampering and wrong rooms', async () => {
  const cipher = await roomCrypto(newSecret()), other = await roomCrypto(newSecret());
  const message = { type: 'state', title: 'Private test task' };
  const a = await cipher.encrypt(message), b = await cipher.encrypt(message);
  assert.notEqual(a, b); assert(!a.includes('Private'));
  assert.deepEqual(await cipher.decrypt(a), message);
  await assert.rejects(other.decrypt(a));
  const parts = a.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(cipher.decrypt(parts.join('.')));
});
test('hidden vote is only a commitment on the wire; both peers reveal and agree', async t => {
  const { host, add, log } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' });
  await host.vote('5'); await guest.vote('8');
  assert.equal(host.state.round.phase, 'voting');
  assert.deepEqual(host.state.round.reveals, {});
  assert(!JSON.stringify(log).includes('"salt"'));
  assert(!JSON.stringify(log).includes('"value":"5"'));
  assert.equal(Object.keys(host.state.round.commits).length, 2);
  await guest.request('reveal');
  await until(() => Object.keys(host.state.round.reveals).length === 2);
  await until(() => Object.keys(guest.state.round.reveals).length === 2);
  assert.equal(summary(Object.values(guest.state.round.reveals).map(v => v.value)).average, 6.5);
});
test('tampered reveal, wrong sender and stale round commands cannot change votes', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' });
  const old = host.state.round.id, salt = randomHex(32);
  await guest.request('commit', { hash: await commitment(old, guest.me, '5', salt) });
  await host.request('reveal');
  await assert.rejects(guest.request('open', { value: '8', salt }), /does not match/);
  await assert.rejects(host.request('open', { value: '5', salt }), /no vote/);
  assert.deepEqual(host.state.round.reveals, {});
  await host.request('reset');
  await host.receive(guest.me, { type: 'request', id: randomHex(), action: 'commit', round: old, data: { hash: 'a'.repeat(64) } });
  assert.deepEqual(host.state.round.commits, {});
});
test('only the creator can publish snapshots; old snapshots cannot roll back state', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' });
  const old = structuredClone(guest.state);
  await guest.receive(randomHex(32), { type: 'state', state: { ...old, name: 'Forged', rev: 99999 } });
  assert.equal(guest.state.name, 'Sprint');
  await host.request('tasks', { titles: ['Task 1'] });
  await until(() => guest.state.tasks.length === 1);
  await guest.receive(host.me, { type: 'state', state: old });
  assert.equal(guest.state.tasks.length, 1);
});
test('observers do not vote; changing roles clears their commitment', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob', observer: true });
  await assert.rejects(guest.vote('3'), /cannot vote/);
  await guest.request('role', { observer: false });
  await guest.vote('3');
  await guest.request('role', { observer: true });
  assert(!Object.hasOwn(host.state.round.commits, guest.me));
});
test('tasks, deck changes and reset synchronize; special cards are excluded from average', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' });
  await guest.request('tasks', { titles: ['Task 1', 'Task 2'] });
  await host.request('select', { id: host.state.tasks[0].id });
  await host.vote('5'); await guest.vote('?'); await host.request('reveal');
  await until(() => Object.keys(host.state.round.reveals).length === 2);
  assert.equal(host.state.tasks[0].result, 5);
  await host.request('deck', { deck: DECKS[4] });
  await until(() => guest.state.deck.id === 'tshirts');
  assert.equal(guest.state.round.phase, 'voting');
  assert.deepEqual(guest.state.round.commits, {});
  assert.equal(summary(['S', 'L', '?']).average, null);
  assert.equal(summary(['½', '1']).average, .8);
});
test('duplicates are idempotent; refreshing a peer preserves its committed secret', async t => {
  const { host, add, peers } = setup(t); let guest = add();
  await guest.request('join', { name: 'Bob' });
  const msg = { type: 'request', id: randomHex(), action: 'tasks', round: host.state.round.id, data: { titles: ['Only once'] } };
  await host.receive(guest.me, msg); await host.receive(guest.me, msg);
  assert.equal(host.state.tasks.length, 1);
  await guest.vote('13');
  const pk = guest.me, saved = structuredClone({ state: guest.state, ballot: guest.ballot });
  guest.close(); peers.delete(pk); guest = add(pk, saved);
  await guest.request('join', { name: 'Bob' });
  await host.request('reveal');
  await until(() => host.state.round.reveals[pk]?.value === '13');
});
test('an offline committed participant is marked missing rather than guessed', async t => {
  const { host, add, peers } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' }); await guest.vote('8');
  guest.close(); peers.delete(guest.me);
  await host.request('reveal');
  assert.equal(Object.keys(host.state.round.commits).length, 1);
  assert.equal(Object.keys(host.state.round.reveals).length, 0);
});
test('a reveal racing with a changed vote retains the last accepted secret', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' }); await guest.vote('5');
  const send = guest.send;
  let intercepted = false;
  guest.send = async message => {
    if (!intercepted && message.action === 'commit') { intercepted = true; await host.request('reveal'); }
    await send(message);
  };
  await assert.rejects(guest.vote('8'), /cannot vote/);
  await until(() => host.state.round.reveals[guest.me]?.value === '5');
  assert.equal(guest.confirmedBallot.value, '5');
});
test('a late joiner receives tasks, a custom deck and already revealed results', async t => {
  const { host, add } = setup(t);
  await host.request('deck', { deck: { id: 'days', name: 'Days', cards: ['½', '1', '2', '?'] } });
  await host.request('tasks', { titles: ['Delivery'] });
  await host.vote('½'); await host.request('reveal');
  await until(() => host.state.round.reveals[host.me]?.value === '½');
  const guest = add(); await guest.request('join', { name: 'Late arrival' });
  assert.equal(guest.state.deck.name, 'Days');
  assert.equal(guest.state.tasks[0].title, 'Delivery');
  assert.equal(guest.state.round.reveals[host.me].value, '½');
});
test('deck and relay configuration reject invalid inputs', () => {
  assert.throws(() => validateDeck({ name: 'Invalid', cards: ['1'] }));
  assert.throws(() => validateDeck({ name: 'Invalid', cards: ['1', '1'] }));
  assert.throws(() => validateRelays(['https://example.com']));
  assert.throws(() => validateRelays(['ws://example.com']));
  assert.deepEqual(validateRelays(['wss://example.com', 'wss://example.com']), ['wss://example.com']);
});

test('restored host grants presence grace and silent members recover on heartbeat', async t => {
  const { host, add } = setup(t), guest = add();
  await guest.request('join', { name: 'Bob' });
  const saved = { state: structuredClone(host.state) };
  const restored = new RoomEngine({ me: host.me, host: host.me, saved, send: async () => {} });
  t.after(() => restored.close());
  await restored.tick();
  assert.equal(restored.state.members[guest.me].online, true);
  restored.lastSeen.set(guest.me, Date.now() - 60_000);
  await restored.tick();
  assert.equal(restored.state.members[guest.me].online, true);
  restored.lastSeen.set(guest.me, Date.now() - 121_000);
  await restored.tick();
  assert.equal(restored.state.members[guest.me].online, false);
  assert.equal(restored.state.members[guest.me].name, 'Bob');
  await restored.receive(guest.me, { type: 'ping' });
  await restored.tick();
  assert.equal(restored.state.members[guest.me].online, true);
});
test('only creator can remove a participant; heartbeat cannot rejoin but explicit join can', async t => {
  const { host, add } = setup(t), guest = add(), other = add();
  await guest.request('join', { name: 'Bob' });
  await other.request('join', { name: 'Carol' });
  await guest.vote('8');
  await assert.rejects(other.request('kick', { pk: guest.me }), /Only the room creator/);
  await assert.rejects(host.request('kick', { pk: host.me }), /creator cannot/);
  await host.request('kick', { pk: guest.me });
  assert.equal(host.state.members[guest.me].removed, true);
  assert.equal(host.state.members[guest.me].online, false);
  assert.equal(host.state.round.commits[guest.me], undefined);
  await until(() => guest.state.members[guest.me].removed);
  await assert.rejects(guest.vote('5'), /removed you/);
  const restored = new RoomEngine({ me: host.me, host: host.me, saved: { state: structuredClone(host.state) }, send: async () => {} });
  t.after(() => restored.close());
  await restored.receive(guest.me, { type: 'ping' }); await restored.tick();
  assert.equal(restored.state.members[guest.me].online, false);
  await restored.apply(guest.me, { action: 'join', data: { name: 'Bob' } });
  assert.equal(restored.state.members[guest.me].online, true);
  assert.equal(restored.state.members[guest.me].removed, undefined);
  assert.equal(restored.state.round.commits[guest.me], undefined);
  await guest.request('join', { name: 'Bob' });
  await guest.vote('5');
  assert.ok(host.state.round.commits[guest.me]);
});
