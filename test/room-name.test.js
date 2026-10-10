import test from 'node:test';
import assert from 'node:assert/strict';
import { DECKS, RoomEngine, roomDisplayName } from '../src/core.js';
const createdAt = Date.UTC(2026,9,10,13,35);
test('automatic names localize dates and clocks but keep Room in English', () => {
  const room = {name:'Room',autoName:true,createdAt};
  assert.equal(roomDisplayName(room,'uk-UA','Europe/Kyiv'), 'Room 10.10.2026 · 16:35');
  assert.equal(roomDisplayName(room,'en-US','Europe/Kyiv'), 'Room 10/10/2026 · 4:35 PM');
  assert.equal(roomDisplayName(room,'en-US','America/New_York'), 'Room 10/10/2026 · 9:35 AM');
  assert.equal(roomDisplayName({...room,createdAt:Date.UTC(2026,9,10,0,15)},'en-US','America/New_York'), 'Room 10/09/2026 · 8:15 PM');
  assert.equal(roomDisplayName({name:'Sprint 42',createdAt},'en-US','UTC'), 'Sprint 42');
  assert.equal(roomDisplayName({name:'Our planning room'},'uk-UA'), 'Our planning room');
});
test('creation timestamp and auto-name flag survive snapshots and refresh', async () => {
  const host = new RoomEngine({me:'host',host:'host'});
  host.create('  ', DECKS[0], 'Alex');
  assert.equal(host.state.autoName,true);
  assert.ok(Number.isFinite(host.state.createdAt));
  const guest = new RoomEngine({me:'guest',host:'host'});
  await guest.receive('host',{type:'state',state:structuredClone(host.state)});
  assert.equal(guest.state.createdAt,host.state.createdAt);
  const restored = new RoomEngine({me:'host',host:'host',saved:{state:structuredClone(host.state)}});
  assert.equal(roomDisplayName(restored.state,'en-US','UTC'),roomDisplayName(host.state,'en-US','UTC'));
  host.create('Sprint 42',DECKS[0],'Alex');
  assert.equal(host.state.autoName,false);
  assert.equal(roomDisplayName(host.state,'uk-UA','Europe/Kyiv'),'Sprint 42');
  host.close(); guest.close(); restored.close();
});
