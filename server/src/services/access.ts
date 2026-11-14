// Qui a le droit de voir un salon ?
import { one } from '../db/pool.js';
import { AppError } from './errors.js';
import { memberContext, type MemberContext } from './permissions.js';

export interface ChannelRow {
  id: number; server_id: number | null; type: 'text' | 'voice' | 'dm' | 'group'; name: string; topic: string;
  slowmode: number; user_limit: number; owner_id: number | null; category_id: number | null;
}

/** Renvoie le salon et (pour un salon de serveur) le contexte du membre ; erreur si pas d'accès. */
export async function channelAccess(channelId: number, userId: number): Promise<{ channel: ChannelRow; member: MemberContext | null }> {
  const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
  if (!channel) throw new AppError('Salon introuvable.', 'not_found');
  if (channel.server_id) {
    const member = await memberContext(channel.server_id, userId);
    if (!member) throw new AppError('Salon introuvable.', 'not_found');
    return { channel, member };
  }
  const recipient = await one('SELECT 1 FROM channel_recipients WHERE channel_id = $1 AND user_id = $2', [channelId, userId]);
  if (!recipient) throw new AppError('Salon introuvable.', 'not_found');
  return { channel, member: null };
}

export async function canSeeChannel(channelId: number, userId: number): Promise<boolean> {
  try {
    await channelAccess(channelId, userId);
    return true;
  } catch {
    return false;
  }
}
