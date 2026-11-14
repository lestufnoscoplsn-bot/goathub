// Salons vocaux (LiveKit) et appels privés.
// Le serveur vérifie les droits et délivre un jeton LiveKit ; le son passe ensuite par le serveur vocal LiveKit (SFU).
import { z } from 'zod';
import { one } from '../../db/pool.js';
import { channelAccess, type ChannelRow } from '../../services/access.js';
import { setVoiceHook } from '../../services/bus.js';
import { AppError } from '../../services/errors.js';
import { kickFromVoice, updateVoicePermissions, voiceToken, type VoiceGrant } from '../../services/livekit.js';
import { memberContext, P } from '../../services/permissions.js';
import { messageById } from '../../services/serialize.js';
import {
  addVoice, callPayload, calls, removeVoice, voiceChannelOf, voiceCount, voiceEntry, voiceUsers, type Call,
} from '../../services/voice.js';
import { emitToChannel, emitToUser, getIo, recipientsOf } from '../hub.js';
import { action, id, type Ctx } from '../registry.js';
import { isBlockedBy } from './social.js';

const RING_MS = 30_000;

async function grantFor(channel: ChannelRow, userId: number): Promise<VoiceGrant & { serverMuted: boolean }> {
  if (!channel.server_id) return { speak: true, stream: true, serverMuted: false };
  const member = await memberContext(channel.server_id, userId);
  if (!member) throw new AppError('Salon introuvable.');
  const timedOut = !!member.mutedUntil;
  return {
    speak: (member.permissions & P.SPEAK) !== 0 && !member.voiceMuted && !timedOut,
    stream: (member.permissions & P.STREAM) !== 0 && !timedOut,
    serverMuted: member.voiceMuted || timedOut || (member.permissions & P.SPEAK) === 0,
  };
}

async function broadcastVoice(channelId: number) {
  const channel = await one<ChannelRow>('SELECT id, server_id FROM channels WHERE id = $1', [channelId]);
  if (channel) await emitToChannel(channel, 'voice:update', { channelId, users: voiceUsers(channelId) });
}

async function broadcastCall(channelId: number) {
  const call = calls.get(channelId);
  const payload = call ? callPayload(call) : { channelId, startedBy: null, ringing: [], ended: true };
  for (const u of await recipientsOf(channelId)) emitToUser(u, 'call:update', payload);
}

/** Quelqu'un quitte un salon vocal (volontairement, coupure, expulsion…). */
async function leave(channelId: number, userId: number) {
  if (!removeVoice(channelId, userId)) return;
  await broadcastVoice(channelId);
  const call = calls.get(channelId);
  if (call && voiceCount(channelId) === 0) await endCall(call);
}

async function endCall(call: Call) {
  clearTimeout(call.timer);
  calls.delete(call.channelId);
  const minutes = Math.max(1, Math.round((Date.now() - call.startedAt) / 60_000));
  const row = await one<{ id: number }>(`INSERT INTO messages (channel_id, author_id, kind, content) VALUES ($1, $2, 'call', $3) RETURNING id`,
    [call.channelId, call.startedBy, `Appel terminé · ${minutes} min`]);
  const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [call.channelId]);
  if (channel) await emitToChannel(channel, 'message:new', await messageById(row!.id));
  await broadcastCall(call.channelId);
}

/** Ferme un salon vocal (salon supprimé, serveur supprimé). */
export async function endVoiceRoom(channelId: number) {
  for (const u of voiceUsers(channelId)) {
    const entry = voiceEntry(channelId, u.userId);
    if (entry) getIo().to(entry.socketId).emit('voice:force-leave', { channelId, reason: 'Le salon vocal a été supprimé.' });
    removeVoice(channelId, u.userId);
  }
}

/** Déconnecte quelqu'un du vocal s'il est dans un salon de ce serveur. */
export async function disconnectVoiceInServer(serverId: number, userId: number) {
  const channelId = voiceChannelOf(userId);
  if (!channelId) return;
  const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
  if (channel?.server_id !== serverId) return;
  const entry = voiceEntry(channelId, userId);
  if (entry) getIo().to(entry.socketId).emit('voice:force-leave', { channelId, reason: 'Un modérateur t’a déconnecté du vocal.' });
  await kickFromVoice(channelId, userId);
  await leave(channelId, userId);
}

/** Applique en direct les droits vocaux (après « rendre muet », exclusion…). */
export async function applyVoicePermissions(serverId: number, userId: number) {
  const channelId = voiceChannelOf(userId);
  if (!channelId) return;
  const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
  if (channel?.server_id !== serverId) return;
  const grant = await grantFor(channel, userId);
  await updateVoicePermissions(channelId, userId, grant);
  const entry = voiceEntry(channelId, userId);
  if (entry) {
    entry.serverMuted = grant.serverMuted;
    if (grant.serverMuted) entry.muted = true;
    getIo().to(entry.socketId).emit('voice:permissions', { channelId, ...grant });
  }
  await broadcastVoice(channelId);
}

/** Une fenêtre se ferme : si elle était en vocal, on la retire. */
export async function voiceSocketClosed(userId: number, socketId: string) {
  const channelId = voiceChannelOf(userId);
  if (channelId && voiceEntry(channelId, userId)?.socketId === socketId) {
    await kickFromVoice(channelId, userId);
    await leave(channelId, userId);
  }
}

// LiveKit confirme les départs (coupure réseau, fenêtre fermée…)
setVoiceHook((channelId, userId, joined) => {
  if (!joined && voiceEntry(channelId, userId)) {
    // On laisse quelques secondes : la personne est peut-être en train de se reconnecter
    setTimeout(() => {
      const entry = voiceEntry(channelId, userId);
      if (entry && Date.now() - entry.joinedAt > 5_000) void leave(channelId, userId);
    }, 4_000);
  }
});

// ----- Actions -----

/** Étape 1 : vérification des droits et jeton LiveKit. */
action('voice:token', z.object({ channelId: id }), async (ctx, { channelId }) => {
  const { channel, member } = await channelAccess(channelId, ctx.userId);
  if (channel.type === 'text') throw new AppError("Ce n'est pas un salon vocal.");
  if (member && !(member.permissions & P.CONNECT)) throw new AppError("Tu n'as pas la permission de rejoindre ce salon vocal.");
  if (channel.user_limit && voiceCount(channelId) >= channel.user_limit && !voiceEntry(channelId, ctx.userId)
      && !(member && member.permissions & P.MODERATE_MEMBERS)) {
    throw new AppError('Ce salon vocal est plein.');
  }
  if (channel.type === 'dm') {
    const other = (await recipientsOf(channelId)).find((u) => u !== ctx.userId);
    if (other && (await isBlockedBy(other, ctx.userId) || await isBlockedBy(ctx.userId, other))) throw new AppError("Impossible d'appeler cette personne.");
  }
  const user = await one<{ username: string }>('SELECT username FROM users WHERE id = $1', [ctx.userId]);
  const grant = await grantFor(channel, ctx.userId);
  return {
    token: await voiceToken(ctx.userId, user!.username, channelId, grant),
    canSpeak: grant.speak,
    canStream: grant.stream,
    serverMuted: grant.serverMuted,
  };
});

/** Étape 2 : la connexion LiveKit est établie, on l'annonce aux autres. */
action('voice:joined', z.object({ channelId: id, muted: z.boolean(), deafened: z.boolean() }), async (ctx, data) => {
  const { channel } = await channelAccess(data.channelId, ctx.userId);
  if (channel.type === 'text') throw new AppError("Ce n'est pas un salon vocal.");
  const previous = voiceChannelOf(ctx.userId);
  if (previous) {
    const old = voiceEntry(previous, ctx.userId);
    if (old && old.socketId !== ctx.socket.id) getIo().to(old.socketId).emit('voice:force-leave', { channelId: previous, reason: 'Tu as rejoint un salon vocal depuis un autre appareil.' });
    if (previous !== data.channelId || old?.socketId !== ctx.socket.id) {
      if (previous !== data.channelId) await kickFromVoice(previous, ctx.userId);
      await leave(previous, ctx.userId);
    }
  }
  const grant = await grantFor(channel, ctx.userId);
  addVoice(data.channelId, {
    userId: ctx.userId, socketId: ctx.socket.id, joinedAt: Date.now(),
    muted: data.muted || grant.serverMuted, deafened: data.deafened, serverMuted: grant.serverMuted, video: false, screen: false,
  });
  const call = calls.get(data.channelId);
  if (call?.ringing.delete(ctx.userId)) await broadcastCall(data.channelId);
  await broadcastVoice(data.channelId);
});

action('voice:leave', z.object({ channelId: id }), async (ctx, { channelId }) => {
  if (voiceEntry(channelId, ctx.userId)?.socketId === ctx.socket.id) await leave(channelId, ctx.userId);
});

action('voice:state', z.object({ muted: z.boolean(), deafened: z.boolean(), video: z.boolean(), screen: z.boolean() }), async (ctx, data) => {
  const channelId = voiceChannelOf(ctx.userId);
  const entry = channelId ? voiceEntry(channelId, ctx.userId) : null;
  if (!channelId || !entry || entry.socketId !== ctx.socket.id) return;
  entry.muted = data.muted || entry.serverMuted;
  entry.deafened = data.deafened;
  entry.video = data.video;
  entry.screen = data.screen;
  await broadcastVoice(channelId);
});

// ----- Appels privés (conversation à deux ou groupe) -----

action('call:start', z.object({ channelId: id }), async (ctx: Ctx, { channelId }) => {
  const { channel } = await channelAccess(channelId, ctx.userId);
  if (channel.type !== 'dm' && channel.type !== 'group') throw new AppError("On ne peut appeler que dans une conversation privée.");
  const others = (await recipientsOf(channelId)).filter((u) => u !== ctx.userId);
  if (channel.type === 'dm' && (await isBlockedBy(others[0], ctx.userId) || await isBlockedBy(ctx.userId, others[0]))) {
    throw new AppError("Impossible d'appeler cette personne.");
  }
  let call = calls.get(channelId);
  if (!call) {
    call = { channelId, startedBy: ctx.userId, startedAt: Date.now(), ringing: new Set() };
    calls.set(channelId, call);
  }
  for (const u of others) if (!voiceEntry(channelId, u)) call.ringing.add(u);
  clearTimeout(call.timer);
  const current = call;
  current.timer = setTimeout(() => {
    // Personne n'a répondu à temps : la sonnerie s'arrête
    current.ringing.clear();
    void broadcastCall(channelId);
    if (voiceCount(channelId) === 0) void endCall(current);
  }, RING_MS);
  await broadcastCall(channelId);
  return callPayload(call);
});

action('call:decline', z.object({ channelId: id }), async (ctx, { channelId }) => {
  await channelAccess(channelId, ctx.userId);
  const call = calls.get(channelId);
  if (!call || !call.ringing.delete(ctx.userId)) return;
  await broadcastCall(channelId);
  emitToUser(call.startedBy, 'call:declined', { channelId, userId: ctx.userId });
  if (!call.ringing.size && voiceCount(channelId) <= 1) {
    // Tout le monde a refusé : on raccroche pour l'appelant
    const entry = voiceEntry(channelId, call.startedBy);
    if (entry) getIo().to(entry.socketId).emit('voice:force-leave', { channelId, reason: "L'appel a été refusé." });
    if (entry) await leave(channelId, call.startedBy);
    else await endCall(call);
  }
});
