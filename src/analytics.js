export const MEASUREMENT_ID = 'G-R1YYF0792Q';
export const ANALYTICS_URL = 'https://roski.github.io/planning-poker/';
const events = new Set(['page_view', 'room_created', 'room_joined', 'round_revealed', 'round_started']);
export function analyticsPayload(name) {
  if (!events.has(name)) return null;
  return { send_to: MEASUREMENT_ID, page_location: ANALYTICS_URL, page_referrer: '', page_title: 'Planning Poker' };
}
export function initAnalytics(win = window, doc = document) {
  if (win.location.origin !== 'https://roski.github.io' || win.location.pathname !== '/planning-poker/') return { track() {} };
  const key = 'poker:analytics-consent';
  const read = () => { try { return win.localStorage.getItem(key); } catch { return null; } };
  let allowed = read() === 'granted', loaded = false;
  const tag = function () { win.dataLayer.push(arguments); };
  function track(name) {
    const payload = analyticsPayload(name);
    if (allowed && loaded && payload) tag('event', name, payload);
  }
  function load() {
    if (loaded || !allowed) return;
    loaded = true;
    win.dataLayer = win.dataLayer || [];
    win.gtag = tag;
    win[`ga-disable-${MEASUREMENT_ID}`] = false;
    tag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    tag('set', { page_location: ANALYTICS_URL, page_referrer: '', page_title: 'Planning Poker', allow_google_signals: false, allow_ad_personalization_signals: false });
    tag('js', new Date());
    tag('config', MEASUREMENT_ID, { ...analyticsPayload('page_view'), send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_path: '/planning-poker/', cookie_domain: 'none' });
    const script = doc.createElement('script');
    script.async = true; script.referrerPolicy = 'no-referrer';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    doc.head.append(script);
    track('page_view');
  }
  const panel = doc.createElement('section');
  panel.className = 'analytics-consent'; panel.setAttribute('aria-label', 'Analytics preferences');
  panel.innerHTML = '<strong>Help improve Planning Poker</strong><p>Allow Google Analytics to measure visits and basic usage? Google receives browser and device information and uses analytics cookies. We do not send room links, names, tasks, or votes.</p><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google privacy policy</a><div><button class="ghost" data-consent="denied">Decline</button><button class="primary" data-consent="granted">Allow analytics</button></div>';
  const settings = doc.createElement('button'); settings.className = 'analytics-settings text-button'; settings.textContent = 'Privacy'; settings.setAttribute('aria-label', 'Analytics privacy settings');
  settings.onclick = () => { panel.hidden = false; panel.querySelector('button').focus(); };
  panel.onclick = event => {
    const choice = event.target.closest('[data-consent]')?.dataset.consent;
    if (!choice) return;
    allowed = choice === 'granted';
    try { win.localStorage.setItem(key, choice); } catch { /* Apply this choice for this page only. */ }
    panel.hidden = true;
    if (allowed) {
      win[`ga-disable-${MEASUREMENT_ID}`] = false;
      if (loaded) tag('consent', 'update', { analytics_storage: 'granted' });
      else load();
    } else {
      win[`ga-disable-${MEASUREMENT_ID}`] = true;
      if (loaded) tag('consent', 'update', { analytics_storage: 'denied' });
      for (const cookie of doc.cookie.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (name === '_ga' || name === `_ga_${MEASUREMENT_ID.slice(2)}`) doc.cookie = `${name}=; Max-Age=0; path=/planning-poker/; SameSite=Lax; Secure`;
      }
    }
  };
  panel.hidden = read() !== null;
  doc.body.append(settings, panel);
  win.addEventListener('storage', event => { if (event.key === key) win.location.reload(); });
  load();
  return { track };
}
