import type { Server } from './types';

export const P = {
  ADMINISTRATOR: 1 << 0, MANAGE_SERVER: 1 << 1, MANAGE_CHANNELS: 1 << 2, MANAGE_ROLES: 1 << 3, MANAGE_MESSAGES: 1 << 4,
  KICK_MEMBERS: 1 << 5, BAN_MEMBERS: 1 << 6, MODERATE_MEMBERS: 1 << 7, CREATE_INVITE: 1 << 8, SEND_MESSAGES: 1 << 9,
  ATTACH_FILES: 1 << 10, ADD_REACTIONS: 1 << 11, MENTION_EVERYONE: 1 << 12, CONNECT: 1 << 13, SPEAK: 1 << 14, STREAM: 1 << 15,
} as const;
export const ALL = (1 << 16) - 1;

export const PERMISSION_INFO: [number, string, string][] = [
  [P.ADMINISTRATOR, 'Administrateur', 'Toutes les permissions. À donner avec prudence.'],
  [P.MANAGE_SERVER, 'Gérer le serveur', 'Nom, icône, invitations, pseudos des autres.'],
  [P.MANAGE_CHANNELS, 'Gérer les salons', 'Créer, modifier, supprimer salons et catégories.'],
  [P.MANAGE_ROLES, 'Gérer les rôles', 'Créer des rôles sous le sien et les attribuer.'],
  [P.MANAGE_MESSAGES, 'Gérer les messages', 'Supprimer et épingler les messages des autres.'],
  [P.KICK_MEMBERS, 'Expulser des membres', ''],
  [P.BAN_MEMBERS, 'Bannir des membres', ''],
  [P.MODERATE_MEMBERS, 'Modérer les membres', 'Rendre muet, exclure temporairement, déconnecter du vocal, voir les signalements.'],
  [P.CREATE_INVITE, 'Créer des invitations', ''],
  [P.SEND_MESSAGES, 'Envoyer des messages', ''],
  [P.ATTACH_FILES, 'Joindre des fichiers', ''],
  [P.ADD_REACTIONS, 'Ajouter des réactions', ''],
  [P.MENTION_EVERYONE, 'Mentionner @everyone', ''],
  [P.CONNECT, 'Se connecter au vocal', ''],
  [P.SPEAK, 'Parler', ''],
  [P.STREAM, "Partager l'écran / la caméra", ''],
];

export function permissionsIn(server: Server | undefined, userId: number): number {
  if (!server) return 0;
  if (server.ownerId === userId) return ALL;
  const member = server.members.find((m) => m.user.id === userId);
  if (!member) return 0;
  let perms = 0;
  for (const role of server.roles) if (role.isDefault || member.roles.includes(role.id)) perms |= role.permissions;
  return perms & P.ADMINISTRATOR ? ALL : perms;
}

export const has = (perms: number, perm: number) => (perms & perm) === perm;

export function topPosition(server: Server, userId: number): number {
  if (server.ownerId === userId) return Infinity;
  const member = server.members.find((m) => m.user.id === userId);
  return Math.max(0, ...server.roles.filter((r) => !r.isDefault && member?.roles.includes(r.id)).map((r) => r.position));
}

export const canActOn = (server: Server, actorId: number, targetId: number) =>
  actorId !== targetId && targetId !== server.ownerId && topPosition(server, actorId) > topPosition(server, targetId);
