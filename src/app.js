import { connectionView, connectionMarkup, connectionLostMessage } from './connection.js';
import { DECKS, RoomEngine, PRESENCE_TIMEOUT, randomHex, hexBytes, newSecret, parseInvite, validateDeck, summary, parseTask, consumeCardInput, roomDisplayName, memberColor, taskInput, splitTaskList } from './core.js';
import { RelayTransport, DEFAULT_RELAYS, getPublicKey, validateRelays } from './transport.js';

const $ = selector => document.querySelector(selector);
const app = $('#app'), modal = $('#modal');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colors = ['#08966e', '#149fab', '#209bbe', '#397cca', '#6660ce', '#8b59bd', '#ac4caa', '#d3488a', '#e34b6c', '#e87344', '#e87344'];
const storage = {
  get(key, fallback, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(`poker:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(`poker:${key}`, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ } },
};
let connectionPendingSince = Date.now(), hadReadyConnection = false, connectionNoticeShown = false, connectionDelayTimer;
let removedDeck = null;
let releaseCreatorLock = null;
let openingRoom = false;
let customDecks = storage.get('decks', []).filter(d => { try { validateDeck(d); return true; } catch { return false; } }).slice(0, 20);
let recentRooms = storage.get('recent', []).filter(r => { try { parseInvite(r.token); return typeof r.name === 'string'; } catch { return false; } }).slice(0, 6);
let relays; try { relays = validateRelays(storage.get('relays', DEFAULT_RELAYS)); } catch { relays = DEFAULT_RELAYS; }
let privateKey = storage.get('identity', null, true);
if (!/^[a-f0-9]{64}$/.test(privateKey || '')) { privateKey = randomHex(32); storage.set('identity', privateKey, true); }
let me = getPublicKey(hexBytes(privateKey));
let engine = null, transport = null, invite = null, relayStatus = [], ticker, presence, readyTimer, stage = '', busy = false;
let modalType = '', modalContext = {}, customValues = [], committedCustomValues = [], confirmCallback, toastTimer, joining = false;
const allDecks = () => {
  const decks = [...DECKS, ...customDecks], current = engine?.state?.deck;
  if (current && !decks.some(d => d.id === current.id)) decks.push(current);
  return decks;
};
const color = (value, cards) => ['?', '☕', '∞'].includes(value) ? '#fffaf1' : colors[Math.round(Math.max(0, cards.filter(c => !['?', '☕', '∞'].includes(c)).indexOf(value)) / Math.max(1, cards.filter(c => !['?', '☕', '∞'].includes(c)).length - 1) * (colors.length - 1))];
const avatarColor = pk => memberColor(engine?.state?.members || {}, pk);
const roomName = room => roomDisplayName(room, navigator.languages);
const initial = name => escape([...name.trim()][0]?.toUpperCase() || '?');
const closeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const taskLinkIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const logo = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="7" width="22" height="29" rx="5" fill="#ac8bcf" stroke="#f8f6fa" stroke-width="1.7" transform="rotate(-12 16 21)"/><rect x="16" y="5" width="22" height="30" rx="5" fill="#59438d" stroke="#f8f6fa" stroke-width="1.7" transform="rotate(7 27 20)"/></svg>';
const brand = () => `<button class="brand" data-action="home" aria-label="Planning Poker home">${logo}Planning Poker</button>`;
const special = value => ['?', '☕', '∞'].includes(value);
const cardSymbol = value => value === '☕' ? '<svg class="coffee-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Zm12 1h2a3 3 0 0 1 0 6h-2M4 22h15M8 3v3m4-4v4m4-3v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' : escape(value);
const cardFace = value => `<span class="corner" aria-hidden="true">${cardSymbol(value)}</span><span class="card-value">${cardSymbol(value)}</span><span class="corner bottom" aria-hidden="true">${cardSymbol(value)}</span>`;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function setHTML(selector, html) {
  const el = $(selector);
  if (!el || el.innerHTML === html) return;
  if (selector === '#table-content' && el.querySelector('.vote-progress') && html.includes('class="vote-progress"')) {
    const template = document.createElement('template'); template.innerHTML = html;
    for (const name of ['.table-status', '.table-hint']) el.querySelector(name).textContent = template.content.querySelector(name).textContent;
    const progress = el.querySelector('.vote-progress'), next = template.content.querySelector('.vote-progress');
    for (const attr of ['aria-valuenow', 'aria-valuemax']) progress.setAttribute(attr, next.getAttribute(attr));
    progress.firstElementChild.style.width = next.firstElementChild.style.width;
    el.querySelector('[data-action="reveal"]').disabled = template.content.querySelector('[data-action="reveal"]').disabled;
    return;
  }
  el.innerHTML = html;

}
function showModal(title, html, type = '') {
  modalType = type;
  modal.classList.toggle('task-dialog', type === 'task-editor');
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${closeIcon}</button></div>${html}<p id="modal-error" class="form-error" role="alert"></p>`;
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => modal.querySelector('[autofocus]')?.focus());
}
function closeModal() { modal.close(); modalType = ''; modalContext = {}; }
function modalError(error) { const el = $('#modal-error'); if (el) el.textContent = error.message || error; else toast(error.message || error); }
function ask(title, text, fn, button = 'Continue') {
  confirmCallback = fn;
  showModal(title, `<p class="modal-description">${escape(text)}</p><div class="modal-actions"><button class="ghost" data-action="close-modal">Cancel</button><button class="primary" data-action="confirm">${escape(button)}</button></div>`, 'confirm');
}
function deckOptions(selected, group = 'deck') {
  const options = allDecks();
  const render = d => `<label class="deck-option"><input type="radio" name="${group}" value="${escape(d.id)}" ${d.id === selected ? 'checked' : ''}><span><strong>${escape(d.name)}</strong><span class="deck-values">${d.cards.map(escape).join(' ')}</span></span></label>`;
  const standard = options.filter(d => DECKS.some(base => base.id === d.id));
  const saved = options.filter(d => customDecks.some(own => own.id === d.id));
  const roomOnly = options.filter(d => !standard.includes(d) && !saved.includes(d));
  return standard.map(render).join('') + (saved.length ? `<details class="saved-decks" ${saved.some(d => d.id === selected) ? 'open' : ''}><summary>Your decks (${saved.length})</summary><div class="deck-options">${saved.map(d => `<div class="saved-deck-row">${render(d)}<button type="button" class="icon-button delete-deck" data-action="delete-deck" data-id="${escape(d.id)}" aria-label="Delete deck ${escape(d.name)}" title="Delete deck">${trashIcon}</button></div>`).join('')}</div></details>` : '') + (roomOnly.length ? `<div class="room-deck-copy"><span class="field-label">Current room deck</span>${roomOnly.map(render).join('')}</div>` : '') + (removedDeck ? `<div class="deck-undo"><span>Deleted “${escape(removedDeck.deck.name)}”</span><button type="button" class="text-button" data-action="undo-delete-deck">Undo</button></div>` : '');
}
function refreshDeckOptions() {
  for (const [selector, group] of [['#home-decks', 'deck'], ['#room-decks', 'room-deck']]) {
    const container = $(selector);
    if (!container) continue;
    const previous = container.querySelector('input:checked')?.value;
    const selected = allDecks().some(d => d.id === previous) ? previous : DECKS[0].id;
    const expanded = container.querySelector('details')?.open;
    container.innerHTML = deckOptions(selected, group);
    if (expanded && container.querySelector('details')) container.querySelector('details').open = true;
    if (group === 'deck' && previous !== selected) renderFan(allDecks().find(d => d.id === selected));
  }
}
function deleteCustomDeck(id) {
  const index = customDecks.findIndex(d => d.id === id);
  if (index < 0) return;
  removedDeck = { deck: customDecks[index], index };
  customDecks.splice(index, 1);
  storage.set('decks', customDecks);
  refreshDeckOptions();
  (modal.open ? modal : app).querySelector('[data-action="undo-delete-deck"]')?.focus();
}

function renderHome() {
  stage = 'home';
  app.innerHTML = `<main class="home"><header class="home-header">${brand()}</header>
    <div class="home-grid"><section class="intro"><h1>Estimate tasks<br>together, right in<br>the browser</h1><p>Create a room and share the link with your team.<br>No sign-up, no server of your own.</p>
      <div class="fan" id="deck-preview" role="img"></div>
      <div class="mini-panels"><section class="mini-panel"><h3>Join with a code</h3><form id="join-code" class="inline-form"><input name="code" aria-label="Room code or link" placeholder="Code or link" required autocomplete="off"><button class="ghost" type="submit">Join</button></form></section><section class="mini-panel"><h3>Recent rooms</h3><div class="recent-list" id="recent-list"></div></section></div>
    </section><section><form id="create-room" class="create-panel"><h2>New room</h2><div class="field"><label for="your-name">Your name</label><input id="your-name" name="name" maxlength="32" value="${escape(storage.get('name', ''))}" placeholder="For example, Alex" required autocomplete="given-name"></div><div class="field"><label for="room-name">Room name <span class="optional">optional</span></label><input id="room-name" name="roomName" maxlength="80" placeholder="For example, Sprint 42"></div><span class="field-label" id="deck-label">Deck</span><div class="deck-options" role="group" aria-labelledby="deck-label" id="home-decks">${deckOptions(DECKS[0].id)}</div><button type="button" class="custom-button" data-action="custom-deck">+ Create a custom deck</button><button class="primary create-room-button" type="submit"><span>Create room</span></button></form></section></div>
    </main>`;
  renderRecent();
  renderFan(DECKS[0]);
}
function renderFan(deck) {
  const fan = $('#deck-preview');
  if (!fan) return;
  const preview = deck.cards.slice(0, 9);
  fan.setAttribute('aria-label', `${deck.name}: ${preview.join(', ')}`);
  // Replacing the cards restarts the staggered deal, including rapid selections.
  fan.innerHTML = preview.map((value, i, cards) => {
    const position = (i / Math.max(1, cards.length - 1) - .5);
    return `<div class="fan-card ${special(value) ? 'special-card' : ''}" aria-hidden="true" style="--i:${i};--spread:${position * 66}%;--angle:${position * 56}deg;--arc:${position * position * 80}px;--card-color:${color(value, deck.cards)}"><div class="fan-face">${cardFace(value)}</div></div>`;
  }).join('');
}
document.addEventListener('change', event => {

  if (event.target.matches('#home-decks input[name="deck"]')) {
    const deck = allDecks().find(d => d.id === event.target.value);
    if (deck) renderFan(deck);
  }
});
function relativeTime(at) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (!minutes) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function recentRoomRows(rooms) {
  return rooms.map((r, i) => `<div class="recent"><button class="recent-open" data-action="recent" data-index="${i}"><strong class="${r.autoName ? 'auto-room-name' : ''}" title="${escape(roomName(r))}">${escape(roomName(r))}</strong><span>${relativeTime(r.at)}</span></button><button class="icon-button" data-action="remove-recent" data-index="${i}" aria-label="Forget ${escape(roomName(r))}">${closeIcon}</button></div>`).join('');
}
function renderRecent() {
  const empty = '<p class="empty-recent">No recent rooms</p>';
  setHTML('#recent-list', recentRooms.length ? recentRoomRows(recentRooms.slice(0, 2)) + (recentRooms.length > 2 ? `<button class="text-button recent-more" data-action="show-recent">Show all (${recentRooms.length})</button>` : '') : empty);
  if (modalType === 'recent-rooms') setHTML('#all-recent-rooms', recentRooms.length ? recentRoomRows(recentRooms) : empty);
}
function openRecentRooms() {
  showModal('Recent rooms', '<div id="all-recent-rooms" class="all-recent-rooms"></div>', 'recent-rooms');
  renderRecent();
}

function remember(state) {
  if (!invite || !state) return;
  const previous = recentRooms.find(r => r.token === invite.token);
  if (previous?.name === state.name && previous?.autoName === state.autoName && previous?.createdAt === state.createdAt) return;
  recentRooms = [{ token: invite.token, name: state.name, autoName: state.autoName, createdAt: state.createdAt, at: Date.now() }, ...recentRooms.filter(r => r.token !== invite.token)].slice(0, 6);
  storage.set('recent', recentRooms);
}
const taskMobileQuery = window.matchMedia('(max-width:740px)');
function syncTaskToggle() {
  const shell = $('.room-shell');
  if (!shell) return;
  const open = taskMobileQuery.matches ? shell.classList.contains('tasks-open') : !shell.classList.contains('tasks-hidden');
  $('.sidebar').inert = !open;
  $('.mobile-tasks')?.setAttribute('aria-expanded', String(open));
  const desktopToggle = $('.desktop-task-toggle');
  desktopToggle?.setAttribute('aria-expanded', String(open));
  desktopToggle?.setAttribute('aria-label', open ? 'Hide task list' : 'Show task list');
}
taskMobileQuery.addEventListener('change', syncTaskToggle);
function roomShell() {
  stage = 'room';
  app.innerHTML = `<div class="room-shell"><header class="room-header">${brand()}<div class="room-identity"><span class="room-label">Room</span><span class="room-title" id="room-title"></span></div><div class="header-actions"><button class="connection" data-action="connection" id="connection-status" aria-label="Connection status"></button><button class="avatar avatar-button" data-action="profile" aria-label="Your profile" id="my-avatar"></button><button class="primary" data-action="invite">Invite</button></div></header><div class="room-body"><button class="desktop-task-toggle" data-action="toggle-tasks" aria-controls="task-sidebar" aria-expanded="true" aria-label="Hide task list"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="m10 4-4 4 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="tasks-backdrop" data-action="toggle-tasks" aria-label="Close task list"></button><aside class="sidebar" id="task-sidebar"><div class="tasks-heading"><div><h2>Tasks</h2><span id="task-count" class="task-count"></span></div><button class="add-task-button" data-action="add-task" aria-label="Add tasks" title="Add tasks">+</button></div><div id="task-list" class="task-list"></div><p class="sidebar-note" id="tasks-empty"></p></aside><main class="room-main"><div class="mobile-task-toolbar"><button class="mobile-tasks" data-action="toggle-tasks" aria-expanded="false" aria-controls="task-sidebar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg><span id="mobile-task-label">Tasks · 0</span></button></div><div class="round-heading" id="round-heading"></div><div class="table-area"><div class="players" id="players"></div><section class="poker-table" aria-label="Voting table"><div class="table-content" id="table-content" aria-live="polite"></div></section></div><section class="deck-dock" aria-label="Your estimation cards"><div class="deck-boundary"><button class="deck-switch" data-action="deck" aria-label="Change deck" title="Change deck"><span id="active-deck-name"></span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="dock-hint" id="dock-hint" aria-live="polite"></div><div class="hand" id="hand"></div></section></main></div></div>`;
}
function renderRoom() {
  const s = engine?.state;
  if (!s || !s.members[me]) return;
  if (s.members[me].removed) {
    if (joining) { waitingScreen(); return; }
    stage = 'removed';
    app.innerHTML = `<main class="home"><header class="home-header">${brand()}</header><section class="waiting"><h1>You’ve been removed</h1><p>The room creator removed you from this room. Refresh the page to join again.</p><button class="primary" data-action="home">Back home</button></section></main>`;
    return;
  }
  if (stage !== 'room') roomShell();
  const self = s.members[me], r = s.round, revealed = r.phase === 'revealed';
  $('#room-title').textContent = s.autoName === true ? roomName(s).replace(/^Room /, '') : roomName(s);
  $('#room-title').title = roomName(s);
  setHTML('#my-avatar', `<span class="avatar-initial">${initial(self.name)}</span>`);
  $('#my-avatar').style.setProperty('--avatar-color', avatarColor(me));
  syncTaskToggle();
  $('#mobile-task-label').textContent = `Tasks · ${s.tasks.length}`;
  const task = s.tasks.find(t => t.id === s.activeTask);
  const taskInfo = task ? parseTask(task) : null;
  setHTML('#round-heading', `<h1 title="${escape(taskInfo?.title || 'Free voting')}">${escape(taskInfo?.title || 'Free voting')}</h1><p class="task-meta">${task ? `<span>Task ${s.tasks.indexOf(task) + 1} of ${s.tasks.length}</span>${taskInfo.url ? `<a href="${escape(taskInfo.url)}" target="_blank" rel="noopener noreferrer">${taskLinkIcon}<span>Open task</span></a>` : ''}` : "Voting that isn’t tied to a task."}</p>`);
  $('#task-count').textContent = s.tasks.length ? `${s.tasks.filter(t => (t.estimate != null || t.result !== null)).length} of ${s.tasks.length} estimated` : '';
  setHTML('#task-list', [{ id: null, title: 'Free voting', result: null }, ...s.tasks].map(t => {
    const info = parseTask(t), active = t.id === s.activeTask;
    return `<div class="task-item ${!t.id ? 'free-voting' : ''} ${active ? 'active' : ''}"><button class="task-select-overlay" data-action="select-task" data-id="${t.id || ''}" aria-label="Select task ${escape(info.title)}" ${active ? 'aria-current="true"' : ''}></button>${!t.id ? '<svg class="free-mode-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="4" y="5" width="13" height="18" rx="3" transform="rotate(-12 10 14)" fill="currentColor" opacity=".18"/><rect x="11" y="4" width="13" height="19" rx="3" stroke="currentColor" stroke-width="1.6" transform="rotate(8 17 14)"/></svg>' : ''}<div class="task-content">${info.url ? `<a class="task-title-link" href="${escape(info.url)}" target="_blank" rel="noopener noreferrer" ><span class="task-title-text">${escape(info.title)}</span></a>` : `<strong class="task-title-button" ><span class="task-title-text">${escape(info.title)}</span></strong>`}${!t.id ? '<span class="task-state">Not tied to a task</span>' : ''}</div>${!t.id ? `<span class="free-mode-indicator" aria-hidden="true">${active ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6 11.5 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span>` : ''}${t.estimate != null || t.result !== null ? `<span tabindex="0" class="task-result ${t.estimate != null ? 'agreed-result' : ''}" data-tooltip="${escape(t.estimate != null ? `Agreed estimate: ${t.estimate} · Average: ${t.result ?? '—'}` : `Average: ${t.result}`)}">${t.estimate != null ? '✓ ' : ''}${escape(t.estimate ?? t.result)}</span>` : ''}${t.id ? `<button class="icon-button task-edit" data-action="edit-task" data-id="${t.id}" aria-label="Edit task ${escape(info.title)}" title="Edit task"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>` : ''}${t.id ? `<button ${active ? 'disabled style="visibility:hidden"' : ''} class="icon-button task-delete" data-action="delete-task" data-id="${t.id}" aria-label="Remove ${escape(info.title)}" title="Delete task">${trashIcon}</button>` : ''}</div>`;
  }).join(''));
  $('#tasks-empty').textContent = s.tasks.length ? '' : 'Add a task or paste a list to get started.';

  renderPlayers(s);
  const voted = Object.keys(r.commits).length;
  const voters = Object.values(s.members).filter(m => !m.observer && m.online).length;
  if (!revealed) {
    const onlineVotes = Object.keys(r.commits).filter(pk => s.members[pk]?.online && !s.members[pk]?.observer).length;
    const status = voters && onlineVotes === voters ? 'Everyone has voted' : `${onlineVotes} of ${voters} voted`;
    setHTML('#table-content', `<p class="table-status">${status}</p><div class="vote-progress" role="progressbar" aria-label="Participants who have voted" aria-valuenow="${onlineVotes}" aria-valuemin="0" aria-valuemax="${Math.max(1, voters)}"><span style="width:${voters ? onlineVotes / voters * 100 : 0}%"></span></div><button class="primary" data-action="reveal" ${!voted ? 'disabled' : ''}>Reveal cards</button><p class="table-hint">${Object.values(s.members).filter(m => m.online).length === 1 ? "You’re the only one here. Click Invite to copy a link for your team." : 'Take your time. Your estimate stays hidden until the reveal.'}</p>`);
  } else {
    const results = summary(Object.values(r.reveals).map(v => v.value));
    const missing = voted - results.total;
    const task = s.tasks.find(t => t.id === s.activeTask);
    const estimateControl = task ? `<div class="estimate-control"><button class="estimate-trigger" data-action="estimate-picker" aria-haspopup="dialog">${task.estimate != null ? '<svg class="estimate-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>' : ''}<span class="estimate-label">${task.estimate != null ? `Agreed: ${escape(task.estimate)}` : 'Set estimate'}</span><svg class="estimate-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div id="estimate-picker" class="estimate-popover" popover role="dialog" aria-label="Agreed estimate"><strong>Agreed estimate</strong><p>Choose the team's final estimate.</p><div class="estimate-cards">${s.deck.cards.map(v => `<button class="hand-card ${special(v) ? 'special-card' : ''}" style="--card-color:${color(v, s.deck.cards)}" data-action="set-estimate" data-id="${task.id}" data-value="${escape(v)}" aria-label="Set estimate to ${escape(v)}" aria-pressed="${task.estimate === v}">${cardFace(v)}</button>`).join('')}</div>${task.estimate != null ? `<button class="text-button" data-action="clear-estimate" data-id="${task.id}">Use average instead</button>` : ''}</div></div>` : '';
    setHTML('#table-content', `<div class="result-top"><div class="average"><strong>${results.average ?? '—'}</strong><small>average</small></div>${estimateControl}</div>${results.consensus ? '<p class="consensus">Everyone agreed</p>' : ''}<div class="distribution">${s.deck.cards.filter(v => results.counts[v]).map(v => `<div class="distribution-row"><span class="result-card ${special(v) ? 'special-card' : ''}" style="--card-color:${color(v, s.deck.cards)}">${escape(v)}</span><div class="bar-track"><div class="bar-fill" style="width:${results.counts[v] / results.total * 100}%;--card-color:${special(v) ? '#baa7d3' : color(v, s.deck.cards)}"></div></div><div class="voter-dots">${Object.entries(r.reveals).filter(([, b]) => b.value === v).slice(0, 6).map(([pk]) => `<span class="voter-dot" title="${escape(r.names[pk])}" style="--avatar-color:${avatarColor(pk)}"><span class="avatar-initial">${initial(r.names[pk] || '?')}</span></span>`).join('')}</div><span>${results.counts[v]}</span></div>`).join('')}</div>${missing ? `<p class="missing-votes">${missing} ${missing === 1 ? 'vote has' : 'votes have'} not been revealed. Waiting for ${missing === 1 ? 'the participant' : 'participants'} to reconnect.</p>` : ''}<div class="results-footer"><span class="results-vote-count">${results.total} ${results.total === 1 ? 'vote' : 'votes'}</span><button class="primary" data-action="reset">New round</button></div>`);
  }
  const selected = engine.confirmedBallot?.value ?? null;
  setHTML('#dock-hint', `<span>${self.observer ? 'You’re watching this round.' : revealed ? 'Cards are revealed. Start a new round to vote again.' : selected ? 'Vote received. You can change it until the cards are revealed.' : 'Pick a card'}</span><button class="text-button" data-action="role" ${revealed ? 'disabled' : ''}>${self.observer ? 'Join voting' : 'Just watch'}</button>`);
  renderHand(s.deck, self.observer, selected, revealed);
  const table = $('.poker-table');
  if (table.dataset.phase !== r.phase) table.dataset.phase = r.phase;

  renderConnection();
}
function renderHand(deck, observer, selected, revealed) {
  const hand = $('#hand');
  $('#active-deck-name').textContent = deck.name;
  $('.deck-switch').setAttribute('aria-label', `Change deck: ${deck.name}`);
  const signature = JSON.stringify([observer, deck.cards]);
  if (hand.dataset.deck !== signature) {
    hand.dataset.deck = signature;
    hand.innerHTML = observer ? '<div class="observer-eyes" role="img" aria-label="Watching the round"><span class="observer-eye" aria-hidden="true"><span class="observer-pupil"></span></span><span class="observer-eye" aria-hidden="true"><span class="observer-pupil"></span></span></div>' : deck.cards.map((v, i) => `<button class="hand-card ${special(v) ? 'special-card' : ''}" data-action="vote" data-value="${escape(v)}" style="--card-color:${color(v, deck.cards)}" aria-label="Vote ${escape(v)}" aria-pressed="false">${cardFace(v)}</button>`).join('');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [...hand.children].forEach((card, i) => card.animate([{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], { duration: 300, delay: i * 24, easing: 'ease-out', fill: 'backwards' }));
    }
  }
  for (const card of hand.querySelectorAll('.hand-card')) {
    const active = card.dataset.value === selected;
    card.classList.toggle('selected', active);
    card.setAttribute('aria-pressed', String(active));
    card.disabled = revealed;
  }
}
function renderPlayers(s) {
  const container = $('#players'), r = s.round;
  const entries = Object.entries(s.members).filter(([, m]) => !m.removed);
  for (const node of [...container.children]) if (!entries.some(([pk]) => pk === node.dataset.pk)) node.remove();
  for (const [pk, member] of entries) {
    let node = [...container.children].find(n => n.dataset.pk === pk);
    if (!node) {
      node = document.createElement('div'); node.className = 'player'; node.dataset.pk = pk;
      node.innerHTML = '<div class="player-card" role="img"><div class="player-card-inner" aria-hidden="true"><div class="card-back"></div><div class="card-front"></div></div></div><span class="player-avatar-wrap"><span class="avatar"><span class="avatar-initial"></span></span></span><span class="player-name"></span><span class="player-label"></span>';
      container.append(node);
    }
    node.classList.toggle('offline', !member.online);
    if (engine.isHost && pk !== me && !node.querySelector('.remove-player')) {
      const remove = document.createElement('button');
      remove.className = 'icon-button remove-player'; remove.dataset.action = 'kick-player'; remove.dataset.pk = pk;
      remove.innerHTML = trashIcon; node.querySelector('.player-avatar-wrap').append(remove);
    }
    node.querySelector('.remove-player')?.setAttribute('aria-label', `Remove ${member.name} from room`);
    const card = node.querySelector('.player-card');
    const value = r.reveals[pk]?.value;
    card.classList.toggle('voted', !!r.commits[pk]);
    const front = node.querySelector('.card-front');
    // Keep the revealed face during the closing flip to avoid a blank flash.
    if (value !== undefined) { front.textContent = value; front.style.setProperty('--card-color', color(value, s.deck.cards)); front.classList.toggle('special-card', special(value)); }
    requestAnimationFrame(() => card.classList.toggle('flipped', r.phase === 'revealed' && value !== undefined));
    node.querySelector('.card-back').innerHTML = member.observer ? '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' : r.commits[pk] ? '✦' : '';
    card.setAttribute('aria-label', member.observer ? 'Observer' : value !== undefined ? `Estimate: ${value}` : r.commits[pk] ? 'Voted, estimate hidden' : 'Not voted');
    node.querySelector('.avatar-initial').textContent = [...member.name][0].toUpperCase();
    node.querySelector('.avatar').style.setProperty('--avatar-color', avatarColor(pk));
    node.querySelector('.player-name').textContent = `${member.name}${pk === me ? ' (you)' : ''}`;
    node.querySelector('.player-label').textContent = !member.online ? 'offline' : member.observer ? 'watching' : pk === invite.host ? 'room creator' : '\u00a0';
  }
}
function currentConnectionView() {
  const ready = relayStatus.some(s => s.state === 'ready');
  const creatorOffline = !!(engine && !engine.isHost && engine.state && Date.now() - engine.lastHost > PRESENCE_TIMEOUT);
  return connectionView({ ready, creatorOffline, elapsed: Date.now() - connectionPendingSince, alone: Object.values(engine?.state?.members || {}).filter(m => m.online).length < 2 });
}
function renderConnection() {
  const ready = relayStatus.some(s => s.state === 'ready');
  if (ready) {
    hadReadyConnection = true; connectionPendingSince = 0;
    if (!(engine && !engine.isHost && engine.state && Date.now() - engine.lastHost > PRESENCE_TIMEOUT)) connectionNoticeShown = false;
    clearTimeout(connectionDelayTimer);
  } else if (!connectionPendingSince) {
    connectionPendingSince = Date.now();
    clearTimeout(connectionDelayTimer);
    connectionDelayTimer = setTimeout(renderConnection, 5100);
  }
  const view = currentConnectionView();
  setHTML('#connection-status', connectionMarkup(view));
  const status = $('#connection-status');
  if (status) {
    status.dataset.state = view.tone;
    status.setAttribute('aria-label', view.label + '. Connection details');
  }
  if (stage === 'room' && hadReadyConnection && view.tone === 'warning' && !connectionNoticeShown) {
    toast(view.label === 'Creator offline' ? 'Room creator is offline. Syncing will resume when they return.' : connectionLostMessage);
    connectionNoticeShown = true;
  }
  if (modalType === 'connection') {
    setHTML('#connection-summary', '<strong>' + view.label + '</strong><p>' + view.detail + '</p>');
    renderRelayList();
  }
}
function waitingScreen() {
  stage = 'waiting';
  app.innerHTML = `<main class="home"><header class="home-header">${brand()}<button class="text-button" data-action="connection">Connection settings</button></header><section class="waiting"><div class="spinner"></div><h1>Finding your table</h1><p>Connecting to the room through encrypted relays.<br>The room creator needs to have their page open.</p><div class="waiting-actions"><button class="secondary" data-action="retry-join">Try again</button><button class="ghost" data-action="home">Back home</button></div><p id="join-status" class="form-error" role="status"></p></section></main>`;
}
function creatorBackup(info) {
  const backup = storage.get(`creator:${info.token}`, null);
  try {
    if (backup?.saved?.state && getPublicKey(hexBytes(backup.privateKey)) === info.host && backup.saved.me === info.host) return backup;
  } catch { /* Ignore invalid local backups. */ }
  return null;
}
async function acquireCreatorLock(token) {
  if (!navigator.locks) throw Error('This browser cannot safely restore creator rooms. Use a current browser over HTTPS.');
  return new Promise((resolve, reject) => {
    navigator.locks.request(`poker:creator:${token}`, { ifAvailable: true }, lock => {
      if (!lock) { reject(Error('This room is already open as creator in another tab. Close that tab and try again.')); return; }
      return new Promise(release => resolve(release));
    }).catch(reject);
  });
}
async function startRoom(info, { name, create = null } = {}) {
  if (openingRoom) return;
  openingRoom = true;
  try {
    stopRoom();
    const backup = create ? null : creatorBackup(info);
    const roomKey = backup?.privateKey || privateKey;
    const roomMe = getPublicKey(hexBytes(roomKey));
    if (roomMe === info.host) releaseCreatorLock = await acquireCreatorLock(info.token);
    privateKey = roomKey; me = roomMe;
    storage.set('identity', privateKey, true);
    invite = info; storage.set('name', name); joining = true;
    location.hash = `room=${info.token}`;
    const saved = backup?.saved || storage.get(`session:${info.token}`, null, true);
    engine = new RoomEngine({ me, host: info.host,
      saved: saved?.me === me ? saved : null,
      send: message => transport?.send(message) || Promise.resolve(),
      onChange: state => { if (state?.members[me]) { joining = false; remember(state); renderRoom(); } },
      onSave: saved => {
        const snapshot = { ...saved, me };
        storage.set(`session:${info.token}`, snapshot, true);
        if (me === info.host && saved.state) storage.set(`creator:${info.token}`, { privateKey, saved: snapshot });
      },
      onError: message => { if (stage === 'waiting') { const e = $('#join-status'); if (e) e.textContent = message; } else toast(message); },
    });
    if (create) engine.create(create.name, create.deck, name);
    else if (engine.state?.members[me]) { engine.save(); renderRoom(); } else waitingScreen();
    await connectTransport();
    ticker = setInterval(() => engine?.tick().catch(() => {}), 10_000);
    presence = setInterval(renderConnection, 5000);
    if (!engine.isHost) joinRoom(name, true);
    else engine.publish();
  } catch (error) { stopRoom(); throw error; }
  finally { openingRoom = false; }
}
async function connectTransport() {
  hadReadyConnection = false; connectionNoticeShown = false; connectionPendingSince = Date.now();
  clearTimeout(connectionDelayTimer);
  transport?.close(); relayStatus = [];
  connectionDelayTimer = setTimeout(renderConnection, 5100);
  const activeEngine = engine;
  transport = new RelayTransport({ secret: invite.secret, privateKey, relays,
    onMessage: (pk, message) => activeEngine.receive(pk, message),
    onStatus: list => { relayStatus = list; renderConnection(); },
    onReady: () => {
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => {
        if (engine !== activeEngine) return;
        if (engine.isHost) engine.publish();
        else { engine.send({ type: 'ping' }); joinRoom(storage.get('name', 'Guest')); }
      }, 250);
    },
  });
  await transport.start();
}
let joinPromise = null;
async function joinRoom(name, explicitJoin = false) {
  if (!engine || engine.isHost || (engine.state?.members[me]?.removed && !explicitJoin) || joinPromise) return;
  joinPromise = engine.request('join', { name }).catch(error => {
    const el = $('#join-status'); if (el) el.textContent = `${error.message} The room may have ended.`; else toast(error.message);
  }).finally(() => { joinPromise = null; });
  await joinPromise;
}
function stopRoom() {
  releaseCreatorLock?.(); releaseCreatorLock = null;
  clearInterval(ticker); clearInterval(presence); clearTimeout(readyTimer); clearTimeout(connectionDelayTimer);
  hadReadyConnection = false; connectionNoticeShown = false; connectionPendingSince = Date.now();
  engine?.close(); transport?.close(); engine = null; transport = null; invite = null; relayStatus = []; joinPromise = null; joining = false;
}
function goHome() {
  const leave = () => { engine?.send({ type: 'request', id: randomHex(), action: 'leave', data: {}, round: engine?.state?.round.id }); stopRoom(); history.replaceState(null, '', location.pathname + location.search); closeModal(); renderHome(); };
  if (engine?.isHost && Object.values(engine.state?.members || {}).filter(m => m.online).length > 1) ask('Leave your room?', 'You are the room creator. Voting will pause for the team until you reopen this room in this browser.', leave, 'Leave room');
  else leave();
}
function promptJoin(info) {
  const backup = creatorBackup(info);
  if (backup) {
    closeModal();
    startRoom(info, { name: backup.saved.state.members[info.host]?.name || storage.get('name', 'Guest') }).catch(error => toast(error.message));
    return;
  }
  modalContext = { invite: info };
  showModal('Take a seat', `<p class="modal-description">Enter your name to join this room.</p><form id="join-room"><div class="field"><label for="join-name">Your name</label><input id="join-name" name="name" maxlength="32" required autofocus value="${escape(storage.get('name', ''))}" autocomplete="given-name"></div><div class="modal-actions"><button type="button" class="ghost" data-action="close-modal">Cancel</button><button class="primary" type="submit">Join room</button></div></form>`, 'join');
}
function openCustom(context = 'home') {
  modalContext = { context }; customValues = []; committedCustomValues = [];
  showModal('Custom deck', `<form id="custom-deck-form"><div class="field"><label for="custom-name">Name</label><input id="custom-name" name="name" placeholder="For example, Days" maxlength="40" required autofocus></div><label for="custom-card">Cards</label><p class="modal-help">Add at least two cards. Separate values with commas.</p><div id="custom-chips" class="custom-card-list"></div><input id="custom-card" placeholder="For example: 1, 2, 3," autocomplete="off"><div class="specials"><span>Add:</span>${['?', '☕', '∞', '½'].map(v => `<button type="button" data-action="special-card" data-value="${v}" aria-label="Add ${v}">${v}</button>`).join('')}</div><div class="modal-actions"><button type="button" class="ghost" data-action="close-modal">Cancel</button><button type="submit" class="primary">Save deck</button></div></form>`, 'custom');
}
function addCustomValues(value) {
  if (customValues.includes(value)) return;
  const result = consumeCardInput(customValues, value, true);
  if (result.error) throw Error(result.error);
  committedCustomValues.push(value);
  consumeCustomField();
}
function consumeCustomField(commit = false) {
  const field = $('#custom-card');
  const result = consumeCardInput(committedCustomValues, field.value, true);
  customValues = result.values;
  // Typing only updates the preview. Enter or Save commits the entire draft.
  if (commit && !result.error) {
    committedCustomValues = [...customValues];
    field.value = '';
  }
  renderChips();
  $('#modal-error').textContent = result.error;
  return !result.error;
}
function removeCustomValue(value) {
  committedCustomValues = committedCustomValues.filter(v => v !== value);
  const field = $('#custom-card');
  field.value = field.value.split(/[,;\n]/).filter(v => v.trim() !== value).join(',');
  consumeCustomField();
}
function renderChips() {
  const container = $('#custom-chips');
  for (const node of [...container.children]) if (!customValues.includes(node.dataset.value)) node.remove();
  for (const [i, value] of customValues.entries()) {
    let card = [...container.children].find(node => node.dataset.value === value);
    if (!card) {
      card = document.createElement('button');
      card.type = 'button'; card.className = `custom-card ${special(value) ? 'special-card' : ''}`;
      card.dataset.action = 'remove-card'; card.dataset.value = value;
      card.setAttribute('aria-label', `Remove ${value}`); card.title = `Remove ${value}`;
      card.innerHTML = `${cardFace(value)}<span class="card-remove" aria-hidden="true">${closeIcon}</span>`;
      container.append(card);
    }
    container.append(card);
    card.dataset.index = i;
    card.style.setProperty('--card-color', color(value, customValues));
    card.style.setProperty('--value-size', `${Math.min(14, 34 / Math.max(1, value.length))}px`);
  }
}


let taskDraft;
function openTaskEditor(id = null) {
  const task = engine.state.tasks.find(t => t.id === id);
  const info = task ? parseTask(task) : { title: '', url: '' };
  taskDraft = { id, mode: 'single', title: info.title, url: info.url || '', manualTitle: !!task, text: '', separator: 'auto', rows: [] };
  renderTaskEditor();
}
function renderTaskEditor() {
  const d = taskDraft;
  showModal(d.id ? 'Edit task' : 'Add tasks', `
    ${d.id ? '' : `<div class="task-modes" role="group" aria-label="Adding mode"><button type="button" data-action="task-mode" data-mode="single" aria-pressed="${d.mode === 'single'}">Single</button><button type="button" data-action="task-mode" data-mode="bulk" aria-pressed="${d.mode === 'bulk'}">Bulk</button></div>`}
    <form id="task-editor-form">
      ${d.mode === 'single' ? `<label for="task-url">Link <span class="optional">optional</span></label><input id="task-url" type="url" placeholder="Paste a task link to fill its title" maxlength="2000" value="${escape(d.url)}"><label for="task-title">Title</label><input id="task-title" placeholder="Task title or ID" maxlength="500" required value="${escape(d.title)}">`
      : `<label for="task-bulk">Task links or titles</label><textarea id="task-bulk" placeholder="Paste links or titles, separated by commas or new lines" maxlength="50000">${escape(d.text)}</textarea><div class="bulk-controls"><span id="separator-label">Separate by</span><div class="task-modes separator-modes" role="group" aria-labelledby="separator-label">${[['auto','Auto'],['lines','New lines'],['commas','Commas']].map(([value,label]) => `<button type="button" data-action="task-separator" data-value="${value}" aria-pressed="${d.separator === value}">${label}</button>`).join('')}</div></div><p class="modal-help">For titles containing commas, use new lines or wrap the title in quotes.</p><div id="task-preview"></div>`}
      <div class="modal-actions"><button type="button" class="ghost" data-action="close-modal">Cancel</button><button class="primary" id="save-tasks" type="submit">${d.id ? 'Save changes' : 'Add task'}</button></div>
    </form>`, 'task-editor');
  if (d.mode === 'bulk') renderTaskPreview();
}
function updateTaskDraft() {
  const counts = new Map();
  const previous = new Map(taskDraft.rows.map(r => [r.key, r]));
  taskDraft.rows = splitTaskList(taskDraft.text, taskDraft.separator).map(raw => {
    const occurrence = counts.get(raw) || 0; counts.set(raw, occurrence + 1);
    const key = JSON.stringify([raw, occurrence]);
    return previous.get(key) || { key, ...parseTask(raw), removed: false };
  });
  renderTaskPreview();
}
function renderTaskPreview() {
  const rows = taskDraft.rows, count = rows.filter(r => !r.removed).length;
  const available = 100 - engine.state.tasks.length;
  setHTML('#task-preview', `<p class="preview-count" aria-live="polite">${count ? `${count} ${count === 1 ? 'task' : 'tasks'} ready` : 'Your tasks will appear here'}${count > available ? ` · Only ${available} spaces left in this room` : ''}</p>${rows.slice(0, 100).map((r, i) => r.removed ? '' : `<div class="task-preview-row"><div><input aria-label="Task ${i + 1} title" data-draft-field="title" data-index="${i}" maxlength="500" value="${escape(r.title)}" required>${r.url ? `<input type="url" aria-label="Task ${i + 1} link" data-draft-field="url" data-index="${i}" maxlength="2000" value="${escape(r.url)}">` : ''}</div><button type="button" class="icon-button" data-action="remove-draft-task" data-index="${i}" aria-label="Remove task ${i + 1} from preview" title="Remove task">${trashIcon}</button></div>`).join('')}`);
  $('#save-tasks').textContent = `Add ${count} ${count === 1 ? 'task' : 'tasks'}`;
  $('#save-tasks').disabled = !count || count > available;
}
function openDeck() {
  showModal('Choose your deck', `<p class="modal-description">A new deck starts a fresh round for everyone.</p><form id="change-deck"><div class="deck-options" id="room-decks">${deckOptions(engine.state.deck.id, 'room-deck')}</div><button type="button" class="custom-button" data-action="custom-room-deck">+ Create a custom deck</button><div class="modal-actions"><button type="button" class="ghost" data-action="close-modal">Cancel</button><button class="primary" type="submit">Use deck</button></div></form>`, 'deck');
}
function inviteURL() { return location.protocol === 'file:' ? invite.token : `${location.href.split('#')[0]}#room=${invite.token}`; }
function openInvite() {
  const local = location.protocol === 'file:';
  showModal('Invite your team', `<p class="modal-description">Choose how to share this room with your team.</p><div class="invite-options">${local ? '' : '<div class="invite-option"><div><strong>Room link</strong><p>Open the link to join this room.</p></div><button class="primary" data-action="copy-invite">Copy link</button></div>'}<div class="invite-option"><div><strong>Invitation code</strong><p>Paste it into “Join with a code” on the home page.</p></div><button class="${local ? 'primary' : 'ghost'}" data-action="copy-code">Copy code</button></div></div><div id="invite-copy-fallback"></div><p class="invite-note">Anyone with the link or code can join. Share it only with your team.</p><p class="invite-note">The creator’s tab keeps the room in sync. Leave it open during your session.</p>`, 'invite');
}

function openConnection() {
  showModal('Connection settings', `<div id="connection-summary" class="connection-summary"></div><p class="modal-description">Rooms use encrypted messages through public Nostr relays. No account or personal server. At least one common relay must work for everyone.</p><div class="relay-list" id="relay-list"></div><form id="relay-form"><label for="relay-addresses">Relay addresses · one per line</label><textarea id="relay-addresses" name="relays" class="relay-editor" spellcheck="false">${escape(relays.join('\n'))}</textarea><p class="modal-help">Use the same list across your team. A corporate network may block individual relays. “Ready” means the relay accepted a message, not that another participant is connected.</p><div class="modal-actions"><button class="text-button" type="button" data-action="default-relays">Restore defaults</button><button class="primary" type="submit">Save & reconnect</button></div></form>`, 'connection');
  renderConnection();
}
function renderRelayList() {
  setHTML('#relay-list', (relayStatus.length ? relayStatus : relays.map(url => ({ url, state: 'idle', detail: 'Connects when you enter a room' }))).map(s => `<div class="relay-row"><span class="status-dot ${s.state === 'ready' ? '' : ['offline', 'rejected'].includes(s.state) ? 'bad' : 'warn'}"></span><div><strong>${escape(s.url.replace(/^wss?:\/\//, ''))}</strong><small>${escape(s.detail || s.state)}</small></div></div>`).join(''));
}
function openProfile() {
  const member = engine.state.members[me];
  showModal('Your profile', `<form id="profile-form"><div class="field"><label for="profile-name">Your name</label><input id="profile-name" name="name" maxlength="32" required value="${escape(member.name)}"></div><p class="modal-description">${engine.isHost ? 'You created this room. Keep this tab open so everyone can stay in sync.' : 'This name is visible to everyone in the room.'}</p><div class="modal-actions"><button class="ghost" type="button" data-action="home">Leave room</button><button class="primary" type="submit">Save name</button></div></form>`, 'profile');
}
function openAbout() {
  showModal('A little less guessing', `<p class="modal-description">Planning Poker is a free, open-source tool for better team conversations. The complete app lives in a single HTML file.</p><ul class="about-list"><li>No registration, database, analytics, or runtime CDN downloads.</li><li>Room messages are encrypted in your browser. Public relays can see connection metadata, but do not receive the room key.</li><li>Estimates stay on each device until reveal. A cryptographic commitment checks that the revealed card matches the vote.</li><li>The room creator coordinates the session. Keep their tab open. Rooms are temporary; recent links aren’t server backups.</li><li>Names, custom decks and recent links are saved on this device. Relay availability and corporate access can vary.</li></ul><p class="modal-help">MIT license · Nostr protocol · Built with nostr-tools and noble cryptography. Licenses are included in this HTML file.</p><div class="modal-actions"><button class="primary" data-action="close-modal">Let’s estimate</button></div>`, 'about');
}
async function act(action, data = {}) {
  if (busy) throw Error('Please wait for your previous action to sync.');
  busy = true; document.body.classList.add('busy');
  try { await engine.request(action, data); }
  finally { busy = false; document.body.classList.remove('busy'); }
}
const taskTooltip = document.createElement('div');
taskTooltip.id = 'task-title-tooltip';
taskTooltip.className = 'task-tooltip';
taskTooltip.setAttribute('role', 'tooltip');
taskTooltip.hidden = true;
document.body.append(taskTooltip);
let tooltipTimer, tooltipAnchor;
function hideTaskTooltip() {
  clearTimeout(tooltipTimer);
  tooltipAnchor?.removeAttribute('aria-describedby');
  tooltipAnchor = null;
  taskTooltip.hidden = true;
}
function showTaskTooltip(event) {
  const row = event.target.closest?.('.task-item');
  if (!row || event.target.closest('.icon-button')) { hideTaskTooltip(); return; }
  const badge = event.target.closest('[data-tooltip]');
  const title = badge || row.querySelector('.task-title-link,.task-title-button');
  if (!title || (!badge && title.scrollWidth <= title.clientWidth + 1)) { hideTaskTooltip(); return; }
  const anchor = badge || event.target.closest('a,button') || row.querySelector('.task-select-overlay');
  if (tooltipAnchor === anchor) return;
  hideTaskTooltip();
  tooltipAnchor = anchor;
  tooltipTimer = setTimeout(() => {
    if (!anchor.isConnected) { hideTaskTooltip(); return; }
    taskTooltip.textContent = badge?.dataset.tooltip || title.textContent;
    taskTooltip.hidden = false;
    const rect = title.getBoundingClientRect(), box = taskTooltip.getBoundingClientRect();
    taskTooltip.style.left = Math.max(12, Math.min(rect.left, innerWidth - box.width - 12)) + 'px';
    taskTooltip.style.top = (rect.bottom + box.height + 20 < innerHeight ? rect.bottom + 10 : Math.max(12, rect.top - box.height - 10)) + 'px';
    anchor.setAttribute('aria-describedby', taskTooltip.id);
  }, 250);
}
document.addEventListener('pointerover', showTaskTooltip);
document.addEventListener('focusin', showTaskTooltip);
document.addEventListener('pointerout', event => {
  const row = event.target.closest?.('.task-item');
  if (row && !row.contains(event.relatedTarget)) hideTaskTooltip();
});
document.addEventListener('focusout', hideTaskTooltip);
document.addEventListener('pointerdown', hideTaskTooltip);
document.addEventListener('scroll', hideTaskTooltip, true);
window.addEventListener('resize', hideTaskTooltip);
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTaskTooltip(); });

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    switch (action) {
      case 'kick-player': {
        const pk = button.dataset.pk, member = engine?.state?.members[pk];
        if (!engine?.isHost || !member || pk === me) break;
        ask('Remove participant?', `Remove ${member.name} from this room? Their vote in the current round will also be removed.`, async () => { await act('kick', { pk }); }, 'Remove participant');
        break;
      }
      case 'add-task': openTaskEditor(); break;
      case 'edit-task': openTaskEditor(button.dataset.id); break;
      case 'task-separator': taskDraft.separator = button.dataset.value; updateTaskDraft(); modal.querySelectorAll('[data-action=task-separator]').forEach(el => el.setAttribute('aria-pressed', String(el === button))); break;
      case 'task-mode': taskDraft.mode = button.dataset.mode; renderTaskEditor(); break;
      case 'remove-draft-task': taskDraft.rows[Number(button.dataset.index)].removed = true; renderTaskPreview(); break;
      case 'home': goHome(); break;
      case 'about': openAbout(); break;
      case 'close-modal': closeModal(); break;
      case 'confirm': { const fn = confirmCallback; closeModal(); await fn?.(); break; }
      case 'custom-deck': openCustom(); break;
      case 'custom-room-deck': openCustom('room'); break;
      case 'special-card': addCustomValues(button.dataset.value); break;
      case 'delete-deck': deleteCustomDeck(button.dataset.id); break;
      case 'undo-delete-deck':
        if (removedDeck) {
          if (customDecks.length >= 20) throw Error('You can save up to 20 custom decks on this device.');
          customDecks.splice(removedDeck.index, 0, removedDeck.deck); removedDeck = null;
          storage.set('decks', customDecks); refreshDeckOptions();
        }
        break;
      case 'remove-card': removeCustomValue(button.dataset.value); break;
      case 'recent': promptJoin(parseInvite(recentRooms[Number(button.dataset.index)].token)); break;
      case 'show-recent': openRecentRooms(); break;
      case 'remove-recent': recentRooms.splice(Number(button.dataset.index), 1); storage.set('recent', recentRooms); renderRecent(); break;
      case 'connection': openConnection(); break;
      case 'default-relays': $('#relay-addresses').value = DEFAULT_RELAYS.join('\n'); break;
      case 'deck': openDeck(); break;
      case 'invite': openInvite(); break;
      case 'profile': openProfile(); break;
      case 'copy-invite':
      case 'copy-code': {
        const code = button.dataset.action === 'copy-code';
        const value = code ? invite.token : inviteURL();
        try {
          await navigator.clipboard.writeText(value);
          $('#invite-copy-fallback').replaceChildren();
          toast(code ? 'Invitation code copied' : 'Room link copied');
        } catch {
          setHTML('#invite-copy-fallback', `<p class="invite-note">Copy manually with Ctrl+C or ⌘C.</p><label for="invite-copy-value">${code ? 'Invitation code' : 'Room link'}</label><textarea id="invite-copy-value" class="invite-field" readonly></textarea>`);
          const field = $('#invite-copy-value');
          field.value = value;
          field.style.height = 'auto';
          field.style.height = `${field.scrollHeight + 2}px`;
          field.focus(); field.select();
        }
        break;
      }
      case 'toggle-tasks': { $('.room-shell').classList.toggle(taskMobileQuery.matches ? 'tasks-open' : 'tasks-hidden'); syncTaskToggle(); break; }
      case 'retry-join': if (engine?.isHost) engine.publish(); else joinRoom(storage.get('name', 'Guest')); break;
      case 'vote': {
        if (busy) break;
        busy = true; button.classList.add('pending'); button.setAttribute('aria-busy', 'true');
        try { const value = button.dataset.value; const selected = engine.confirmedBallot?.value === value; await engine.vote(selected ? null : value); }
        finally { busy = false; button.classList.remove('pending'); button.removeAttribute('aria-busy'); }
        break;
      }
      case 'estimate-picker': {
        const picker = $('#estimate-picker'); picker.showPopover();
        const rect = button.getBoundingClientRect();
        picker.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - picker.offsetWidth - 12))}px`;
        picker.style.top = `${Math.max(12, Math.min(rect.bottom + 10, innerHeight - picker.offsetHeight - 12))}px`;
        picker.querySelector('button')?.focus(); break;
      }
      case 'set-estimate': case 'clear-estimate':
        $('#estimate-picker')?.hidePopover();
        await act('estimate', { id: button.dataset.id, value: button.dataset.action === 'clear-estimate' ? null : button.dataset.value });
        $('[data-action="estimate-picker"]')?.focus(); break;
      case 'reveal': await act('reveal'); break;
      case 'reset': await act('reset'); break;
      case 'role': await act('role', { observer: !engine.state.members[me].observer }); break;
      case 'select-task': {
        const id = button.dataset.id || null;
        if (id === engine.state.activeTask) break;
        const fn = async () => { await act('select', { id }); if (taskMobileQuery.matches) $('.room-shell')?.classList.remove('tasks-open'); syncTaskToggle(); };
        if (engine.state.round.phase === 'voting' && Object.keys(engine.state.round.commits).length) ask('Switch task?', 'This starts a fresh round and clears the current hidden votes.', fn, 'Switch task'); else await fn();
        break;
      }
      case 'delete-task': await act('delete-task', { id: button.dataset.id }); break;
    }
  } catch (error) { if (modal.open) modalError(error); else toast(error.message); }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, data = new FormData(form);
  try {
    switch (form.id) {
      case 'create-room': {
        if (joining || engine) break;
        if (!crypto.subtle) throw Error('Open this file directly or use an HTTPS website. Encryption requires a secure context.');
        const name = data.get('name').trim(); if (!name) throw Error('Enter your name.');
        const info = parseInvite(`${newSecret()}.${me}`);
        await startRoom(info, { name, create: { name: data.get('roomName').trim(), deck: allDecks().find(d => d.id === data.get('deck')) || DECKS[0] } });
        break;
      }
      case 'join-code': promptJoin(parseInvite(data.get('code'))); break;
      case 'join-room': { const info = modalContext.invite, name = data.get('name').trim(); if (!name) throw Error('Enter your name.'); closeModal(); await startRoom(info, { name }); break; }
      case 'custom-deck-form': {
        if (!consumeCustomField(true)) return;
        const deck = validateDeck({ id: `custom-${randomHex(8)}`, name: data.get('name').trim(), cards: customValues });
        if (customDecks.length >= 20) throw Error('You can save up to 20 custom decks on this device.');
        const context = modalContext.context;
        customDecks.push(deck); storage.set('decks', customDecks); closeModal();
        if (context === 'room') { openDeck(); const option = modal.querySelector(`input[value="${deck.id}"]`); option.checked = true; option.closest("details").open = true; }
        else { setHTML('#home-decks', deckOptions(deck.id)); renderFan(deck); }
        toast('Your custom deck is ready.'); break;
      }
      case 'change-deck': {
        const deck = allDecks().find(d => d.id === data.get('room-deck')); if (!deck) throw Error('Choose a deck.');
        const fn = async () => { await act('deck', { deck }); closeModal(); toast('Deck changed. A fresh round is ready.'); };
        if (Object.keys(engine.state.round.commits).length && engine.state.round.phase === 'voting') ask('Change deck?', 'This clears the hidden votes and starts a fresh round for everyone.', fn, 'Change deck'); else await fn();
        break;
      }
      case 'task-editor-form': {
        if (taskDraft.mode === 'single') {
          const item = taskInput({ title: taskDraft.title, url: taskDraft.url.trim() });
          if (taskDraft.id) await act('edit-task', { id: taskDraft.id, item });
          else await act('tasks', { items: [item] });
        } else {
          const items = taskDraft.rows.filter(r => !r.removed).map(r => taskInput(r));
          if (!items.length) throw Error('Add at least one task.');
          await act('tasks', { items });
        }
        closeModal(); break;
      }
      case 'profile-form': { const name = data.get('name').trim(); await act('rename', { name }); storage.set('name', name); closeModal(); break; }
      case 'relay-form': {
        relays = validateRelays(data.get('relays').split('\n')); storage.set('relays', relays);
        closeModal(); if (engine) await connectTransport(); toast('Connection settings saved.'); break;
      }
    }
  } catch (error) { if (modal.open) modalError(error); else toast(error.message); }
});
document.addEventListener('input', event => {
  const field = event.target;
  if (modalType === 'task-editor') {
    if (field.id === 'task-title') { taskDraft.title = field.value; taskDraft.manualTitle = true; }
    if (field.id === 'task-url') {
      taskDraft.url = field.value;
      if (!taskDraft.manualTitle) { taskDraft.title = parseTask(field.value).title; $('#task-title').value = taskDraft.title; }
    }
    if (field.id === 'task-bulk') { taskDraft.text = field.value; updateTaskDraft(); }
    if (field.dataset.draftField) taskDraft.rows[Number(field.dataset.index)][field.dataset.draftField] = field.value;
  }

  if (event.target.id === 'custom-card' && !event.isComposing) consumeCustomField();
});
document.addEventListener('compositionend', event => {
  if (event.target.id === 'custom-card') consumeCustomField();
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'custom-card' && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); try { consumeCustomField(true); } catch (error) { modalError(error); } }
});
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
modal.addEventListener('close', () => { modalType = ''; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && engine) { engine.tick(); if (!engine.isHost) joinRoom(storage.get('name', 'Guest')); } });
window.addEventListener('pagehide', () => { engine?.save(); stopRoom(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('online', () => { if (engine) connectTransport(); });
window.addEventListener('hashchange', () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('room');
  if (token === invite?.token) return;
  if (!token) { stopRoom(); renderHome(); return; }
  try { promptJoin(parseInvite(token)); } catch (e) { toast(e.message); }
});
try {
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key?.startsWith('poker:session:')) continue;
    const token = key.slice('poker:session:'.length), info = parseInvite(token);
    const saved = storage.get(`session:${token}`, null, true);
    if (info.host === me && saved?.me === me && saved.state && !creatorBackup(info)) storage.set(`creator:${token}`, { privateKey, saved });
  }
} catch { /* Storage may be unavailable. */ }
renderHome();
const initialToken = new URLSearchParams(location.hash.slice(1)).get('room');
if (initialToken) {
  try {
    const info = parseInvite(initialToken);
    const saved = storage.get(`session:${info.token}`, null, true);
    if (saved?.me === me && saved.state?.members[me] && !saved.state.members[me].removed) startRoom(info, { name: saved.state.members[me].name }).catch(e => toast(e.message));
    else promptJoin(info);
  } catch (error) { toast(error.message); }
}
