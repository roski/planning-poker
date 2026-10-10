export function connectionView({ ready, creatorOffline, elapsed, alone = false }) {
  if (creatorOffline) return { label: 'Creator offline', tone: 'warning', detail: 'The room creator is offline. Keep this page open; syncing will resume when they return.' };
  if (ready) return { label: alone ? 'Just you' : 'Connected', tone: 'ready', detail: alone ? 'Connection is ready. Invite your team to join.' : 'Connection is ready. Messages can be shared with your team.' };
  if (elapsed < 5000) return { label: 'Connecting…', tone: 'connecting', detail: 'Connecting and checking that messages can be sent.' };
  return { label: 'Connection issue', tone: 'warning', detail: 'No relay has confirmed it can accept messages. Other participants may not see your changes yet. We are retrying automatically.' };
}
export function connectionMarkup(view) {
  return '<span class="status-dot ' + (view.tone === 'connecting' ? 'connecting' : view.tone === 'warning' ? 'warn' : '') + '"></span><span class="connection-label">' + view.label + '</span>';
}
export const connectionLostMessage = 'Connection lost. Your changes may not reach the team. Reconnecting…';
