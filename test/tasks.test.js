import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTask, splitTaskList, taskInput, RoomEngine, DECKS } from '../src/core.js';
test('task references keep original links and extract tracker identifiers', () => {
  for (const [url, title] of [
    ['https://dev.azure.com/org/project/_workitems/edit/480510', '#480510'],
    ['https://jira.example.com/browse/PROJ-123', 'PROJ-123'],
    ['https://github.com/team/project/issues/42', 'project #42'],
    ['https://linear.app/team/issue/ENG-123/fix-login', 'Fix login'],
    ['https://jira.example.com/board?selectedIssue=PROJ-9', 'PROJ-9'],
    ['https://tracker.example.com/view?workItemId=480510', '#480510'],
  ]) assert.deepEqual(parseTask(url), { title, url });
  assert.deepEqual(parseTask('480510'), { title: '#480510', url: null });
  assert.deepEqual(parseTask('Improve search'), { title: 'Improve search', url: null });
  assert.equal(parseTask('https://example.com/spec?q=hello').title, 'https://example.com/spec?q=hello');
});
test('bulk input handles mixed lists, URL commas, quoted titles and explicit new lines', () => {
  assert.deepEqual(splitTaskList('Login, Search,https://jira.example.com/browse/ABC-2'), ['Login', 'Search', 'https://jira.example.com/browse/ABC-2']);
  assert.deepEqual(splitTaskList('https://example.com/a,b?q=x,y, https://example.com/c'), ['https://example.com/a,b?q=x,y', 'https://example.com/c']);
  assert.deepEqual(splitTaskList('"Search, filters", "Say ""hello""", Login', 'commas'), ['Search, filters', 'Say "hello"', 'Login']);
  assert.deepEqual(splitTaskList('Search, filters\nLogin'), ['Search, filters', 'Login']);
  assert.deepEqual(splitTaskList('\n \n'), []);
});
test('explicit titles and links survive task creation, editing and guest snapshots', async () => {
  const host = new RoomEngine({ me: 'host', host: 'host' });
  host.create('Review', DECKS[0], 'Alex');
  await host.apply('host', { action: 'tasks', round: host.state.round.id, data: { items: [{ title: 'Improve login', url: 'https://jira.example.com/browse/ABC-2' }] } });
  const task = host.state.tasks[0];
  assert.equal(task.title, 'Improve login');
  await host.apply('host', { action: 'edit-task', round: host.state.round.id, data: { id: task.id, item: { title: 'Login, validation', url: task.url } } });
  const guest = new RoomEngine({ me: 'guest', host: 'host' });
  await guest.receive('host', { type: 'state', state: structuredClone(host.state) });
  assert.deepEqual(parseTask(guest.state.tasks[0]), { title: 'Login, validation', url: task.url });
  assert.equal(parseTask({ title: 'https://jira.example.com/browse/OLD-1' }).title, 'OLD-1');
  assert.throws(() => taskInput({ title: 'Unsafe', url: 'javascript:alert(1)' }));
  const count = host.state.tasks.length;
  await assert.rejects(host.apply('host', { action: 'tasks', round: host.state.round.id, data: { items: [{ title: 'Valid' }, { title: '' }] } }));
  assert.equal(host.state.tasks.length, count);
});
test('unsafe schemes and credential-bearing URLs never become clickable task links', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', 'https://user:password@example.com/42']) assert.equal(parseTask(input).url, null);
});
