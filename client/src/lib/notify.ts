// Notifications du bureau et sons.
import { navigate } from './router';
import { displayName, get } from './store';
import { local } from './storage';
import { sounds } from './sounds';
import type { Message } from './types';

export const settings = {
  get desktop() { return local.get('notif:desktop', true); },
  get sound() { return local.get('notif:sound', true); },
};

export async function askPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export function notifyText(title: string, body: string, path: string | null) {
  if (get().me?.statusPref === 'dnd') return;
  if (settings.sound) sounds.mention();
  if (!settings.desktop || document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', silent: true });
    n.onclick = () => { window.focus(); if (path) navigate(path); n.close(); };
  } catch { /* indisponible */ }
}

export function notifyMessage(msg: Message) {
  const author = msg.author ? displayName(msg.author.id, msg.serverId) : 'GoatHub';
  let title = author;
  if (msg.serverId) {
    const server = get().servers[msg.serverId];
    const channel = server?.channels.find((c) => c.id === msg.channelId);
    title = `${author} · #${channel?.name ?? '?'} (${server?.name ?? ''})`;
  }
  const body = msg.content.replace(/<@(\d+)>/g, (_, id) => '@' + displayName(Number(id), msg.serverId)).slice(0, 140) || 'Pièce jointe';
  notifyText(title, body, msg.serverId ? `/channels/${msg.serverId}/${msg.channelId}` : `/channels/@me/${msg.channelId}`);
}
