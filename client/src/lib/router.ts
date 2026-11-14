// Navigation (adresses du type /channels/12/34) sans bibliothèque.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home'; dmId?: number; tab?: string }
  | { name: 'server'; serverId: number; channelId?: number }
  | { name: 'invite'; code: string };

export function parse(path: string): Route {
  let m = path.match(/^\/invite\/([A-Za-z0-9]{6,16})\/?$/);
  if (m) return { name: 'invite', code: m[1] };
  m = path.match(/^\/channels\/@me\/(\d+)/);
  if (m) return { name: 'home', dmId: Number(m[1]) };
  m = path.match(/^\/channels\/(\d+)(?:\/(\d+))?/);
  if (m) return { name: 'server', serverId: Number(m[1]), channelId: m[2] ? Number(m[2]) : undefined };
  return { name: 'home' };
}

const listeners = new Set<() => void>();
let current = parse(location.pathname);
const notify = () => { current = parse(location.pathname); listeners.forEach((l) => l()); };
window.addEventListener('popstate', notify);

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  notify();
}

export const useRoute = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
export const getRoute = () => current;
