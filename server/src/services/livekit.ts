// LiveKit (serveur vocal SFU) : jetons d'accès et commandes de modération.
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { config } from '../config.js';

export const roomService = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
export const webhookReceiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export const roomName = (channelId: number) => `ch_${channelId}`;
export const channelOfRoom = (room: string) => (/^ch_\d+$/.test(room) ? Number(room.slice(3)) : null);

export interface VoiceGrant { speak: boolean; stream: boolean }

/** Jeton valable 10 minutes pour rejoindre un salon vocal, avec seulement les droits autorisés. */
export async function voiceToken(userId: number, username: string, channelId: number, grant: VoiceGrant): Promise<string> {
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: String(userId),
    name: username,
    ttl: '10m',
  });
  token.addGrant({
    room: roomName(channelId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: grant.speak || grant.stream,
    canPublishData: false,
    canPublishSources: [
      ...(grant.speak ? [TrackSource.MICROPHONE] : []),
      ...(grant.stream ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA] : []),
    ],
    canUpdateOwnMetadata: false,
  });
  return token.toJwt();
}

/** Change en direct ce qu'un participant a le droit de publier (ex : rendu muet par un modérateur). */
export async function updateVoicePermissions(channelId: number, userId: number, grant: VoiceGrant): Promise<void> {
  try {
    await roomService.updateParticipant(roomName(channelId), String(userId), undefined, {
      canSubscribe: true,
      canPublish: grant.speak || grant.stream,
      canPublishData: false,
      canPublishSources: [
        ...(grant.speak ? [TrackSource.MICROPHONE] : []),
        ...(grant.stream ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA] : []),
      ],
    });
  } catch {
    /* la personne n'est peut-être plus dans le salon */
  }
}

export async function kickFromVoice(channelId: number, userId: number): Promise<void> {
  try {
    await roomService.removeParticipant(roomName(channelId), String(userId));
  } catch {
    /* déjà partie */
  }
}

export async function closeRoom(channelId: number): Promise<void> {
  try {
    await roomService.deleteRoom(roomName(channelId));
  } catch {
    /* salle inexistante */
  }
}
