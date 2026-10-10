import test from 'node:test';
import assert from 'node:assert/strict';
import { memberColor } from '../src/core.js';

test('member colors are distinct and stable through joins, renames and snapshots', () => {
  const members = {};
  const assigned = new Map();
  for (let i = 0; i < 50; i++) {
    const key = `participant-${i}`;
    members[key] = { name: `User ${i}`, online: true };
    assigned.set(key, memberColor(members, key));
    for (const [pk, color] of assigned) assert.equal(memberColor(members, pk), color);
  }
  assert.equal(new Set(assigned.values()).size, 50);
  members['participant-0'] = { name: 'Renamed', online: false };
  const snapshot = JSON.parse(JSON.stringify(members));
  for (const [pk, color] of assigned) assert.equal(memberColor(snapshot, pk), color);
});
