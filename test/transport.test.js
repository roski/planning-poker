import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import { RelayTransport, getPublicKey } from '../src/transport.js';
import { RoomEngine, DECKS, randomHex, hexBytes, newSecret } from '../src/core.js';
import { setTimeout as delay } from 'node:timers/promises';

const until = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await delay(10); } throw Error('Network condition timed out'); };
test('two signed, encrypted clients synchronize through real WebSocket relay connections', async t => {
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => relay.on('listening', resolve));
  const messages = [], transports = [], engines = [];
  t.after(async () => { engines.forEach(e => e.close()); transports.forEach(tr => tr.close()); for (const c of relay.clients) c.terminate(); await new Promise(resolve => relay.close(resolve)); });
  relay.on('connection', socket => {
    socket.on('message', raw => {
      const data = JSON.parse(raw.toString());
      if (data[0] === 'REQ') { socket.filter = data[2]; socket.send(JSON.stringify(['EOSE', data[1]])); }
      if (data[0] !== 'EVENT') return;
      const event = data[1];
      assert(verifyEvent(event)); messages.push(event);
      socket.send(JSON.stringify(['OK', event.id, true, '']));
      for (const client of relay.clients) if (client.filter?.['#h']?.[0] === event.tags[0][1]) client.send(JSON.stringify(['EVENT', 'poker', event]));
    });
  });
  const secret = newSecret(), hostPrivate = randomHex(32), hostKey = getPublicKey(hexBytes(hostPrivate));
  async function client(privateKey) {
    let transport;
    const engine = new RoomEngine({ me: getPublicKey(hexBytes(privateKey)), host: hostKey, send: m => transport.send(m) }); engines.push(engine);
    transport = new RelayTransport({ secret, privateKey, relays: [`ws://127.0.0.1:${relay.address().port}`], onMessage: (pk, m) => engine.receive(pk, m), onStatus: () => {}, onReady: () => {} });
    transports.push(transport); await transport.start();
    await until(() => [...transport.sockets.values()].some(s => s.state === 'connected'));
    return engine;
  }
  const host = await client(hostPrivate); host.create('Private test', DECKS[0], 'Host');
  const guest = await client(randomHex(32));
  await guest.request('join', { name: 'Guest' });
  await host.vote('3'); await guest.vote('8');
  assert(!JSON.stringify(messages).includes('Private test'));
  assert(!JSON.stringify(messages).includes('Guest'));
  await guest.request('reveal');
  await until(() => Object.keys(guest.state.round.reveals).length === 2);
  assert.deepEqual(Object.values(guest.state.round.reveals).map(v => v.value).sort(), ['3', '8']);
});
