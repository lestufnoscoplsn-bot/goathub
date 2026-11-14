// Nettoyage des textes reçus : forme Unicode normale, sans caractères invisibles ou trompeurs.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export const clean = (text: string) => text.normalize('NFC').replace(INVISIBLE, '');

export function networkHint(ip: string): string {
  if (ip.includes(':') && !ip.startsWith('::ffff:')) return ip.split(':').slice(0, 3).join(':') + ':…';
  const parts = ip.replace('::ffff:', '').split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : '?';
}

export function deviceName(userAgent = ''): string {
  const browser = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']]
    .find(([k]) => userAgent.includes(k))?.[1] ?? 'Navigateur';
  const os = [['Windows', 'Windows'], ['Android', 'Android'], ['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Mac OS', 'Mac'], ['Linux', 'Linux']]
    .find(([k]) => userAgent.includes(k))?.[1] ?? 'système inconnu';
  return `${browser} sur ${os}`;
}
