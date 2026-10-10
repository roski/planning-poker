import test from 'node:test';
import assert from 'node:assert/strict';
import { initAnalytics, analyticsPayload, ANALYTICS_URL } from '../src/analytics.js';

function browser(choice = null, origin = 'https://roski.github.io') {
  const scripts = [], nodes = [], values = new Map(choice ? [['poker:analytics-consent', choice]] : []);
  const win = { location: { origin, pathname: '/planning-poker/', hash: '#room=PRIVATE', search: '?name=PRIVATE' }, localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }, addEventListener() {} };
  const doc = { cookie: '', head: { append: s => scripts.push(s) }, body: { append: (...items) => nodes.push(...items) }, createElement: () => ({ setAttribute() {}, querySelector: () => ({ focus() {} }) }) };
  const api = initAnalytics(win, doc);
  const choose = value => nodes[1].onclick({ target: { closest: () => ({ dataset: { consent: value } }) } });
  return { win, scripts, api, choose };
}
test('analytics is opt-in, excludes private URLs and sends only allowlisted events', () => {
  const b = browser();
  b.api.track('room_created'); assert.equal(b.scripts.length, 0);
  b.choose('denied'); assert.equal(b.scripts.length, 0);
  b.choose('granted'); assert.equal(b.scripts.length, 1);
  b.api.track('room_created'); b.api.track('PRIVATE');
  const commands = b.win.dataLayer.map(args => [...args]);
  assert(!JSON.stringify(commands).includes('PRIVATE'));
  const events = commands.filter(x => x[0] === 'event');
  assert.deepEqual(events.map(x => x[1]), ['page_view', 'room_created']);
  assert(events.every(x => x[2].page_location === ANALYTICS_URL && x[2].page_referrer === ''));
  b.choose('denied'); const count = b.win.dataLayer.length;
  b.api.track('round_started'); assert.equal(b.win.dataLayer.length, count);
  assert.equal(b.win['ga-disable-G-R1YYF0792Q'], true);
});
test('analytics stays off on local previews and honors remembered choices', () => {
  assert.equal(browser('granted', 'http://localhost:4173').scripts.length, 0);
  assert.equal(browser('denied').scripts.length, 0);
  assert.equal(browser('granted').scripts.length, 1);
  assert.equal(analyticsPayload('task_name'), null);
});
