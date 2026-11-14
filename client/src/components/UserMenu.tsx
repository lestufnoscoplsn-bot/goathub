// Fiche d'un utilisateur : profil, actions (message, appel, ami), volume en vocal et modération.
import { Ban, Clock, Flag, MessageCircle, MicOff, Phone, PhoneOff, Shield, UserMinus, UserPlus, UserX, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../lib/router';
import { emit } from '../lib/socket';
import { closeModal, displayName, openModal, toast, upsertDm, useStore } from '../lib/store';
import { canActOn, has, P, permissionsIn } from '../lib/permissions';
import { colorFor, STATUS_LABEL } from '../lib/format';
import type { Dm } from '../lib/types';
import { userVolume, voice } from '../voice/voice';
import { Avatar } from './ui/Avatar';
import { closePopover } from './ui/Menu';

export async function openDmWith(userId: number, call = false) {
  try {
    const dm = await emit<Dm>('dm:open', { userId });
    upsertDm(dm);
    navigate(`/channels/@me/${dm.id}`);
    if (call) await startCall(dm.id);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

export async function startCall(channelId: number) {
  try {
    await emit('call:start', { channelId });
    await voice.join(channelId);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function Action({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => unknown; danger?: boolean }) {
  return (
    <button onClick={async () => { closePopover(); try { await onClick(); } catch (e) { toast((e as Error).message, 'error'); } }}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${danger ? 'text-bad hover:bg-bad hover:text-white' : 'text-zinc-200 hover:bg-ink-600'}`}>
      {icon}{label}
    </button>
  );
}

export function UserMenu({ userId, serverId }: { userId: number; serverId?: number }) {
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.me!);
  const relation = useStore((s) => s.relations[userId]);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const inMyVoice = useStore((s) => !!s.voice.channelId && (s.voiceStates[s.voice.channelId] ?? []).some((u) => u.userId === userId));
  const [volume, setVolume] = useState(userVolume(userId));
  if (!user) return null;
  const isMe = userId === me.id;
  const member = server?.members.find((m) => m.user.id === userId);
  const perms = permissionsIn(server, me.id);
  const canMod = server ? canActOn(server, me.id, userId) : false;
  const roles = server && member ? server.roles.filter((r) => member.roles.includes(r.id)) : [];

  return (
    <div className="w-[320px] overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-pop">
      <div className="h-16" style={{ background: `linear-gradient(135deg, ${user.accentColor || colorFor(user.id)}, #c026d3)` }} />
      <div className="-mt-10 px-4"><div className="inline-block rounded-full border-[5px] border-ink-900"><Avatar user={user} size={76} status /></div></div>
      <div className="space-y-3 px-4 pb-4 pt-1">
        <div>
          <div className="text-lg font-bold">{member?.nickname || user.username}{server?.ownerId === userId && <span title="Propriétaire" className="ml-1">👑</span>}</div>
          <div className="text-sm text-zinc-400">{user.username} · {STATUS_LABEL[user.status]}</div>
          {user.customStatus && <div className="mt-1 text-sm">{user.customStatus}</div>}
        </div>
        {user.bio && <div><div className="section-title px-0">À propos</div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-300">{user.bio}</p></div>}
        {roles.length > 0 && (
          <div><div className="section-title px-0">Rôles</div>
            <div className="mt-1 flex flex-wrap gap-1">{roles.map((r) => <span key={r.id} className="chip"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}</span>)}</div>
          </div>
        )}
        {member?.mutedUntil && <div className="chip bg-warn/20 text-warn"><Clock size={12} /> Exclu jusqu'à {new Date(member.mutedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>}
        {inMyVoice && !isMe && (
          <div>
            <div className="flex justify-between text-xs text-zinc-400"><span className="flex items-center gap-1"><Volume2 size={13} /> Volume pour moi</span><span>{Math.round(volume * 100)} %</span></div>
            <input type="range" min={0} max={2} step={0.05} value={volume} aria-label="Volume de cette personne" className="mt-1 w-full accent-brand-500"
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); voice.setUserVolume(userId, v); }} />
          </div>
        )}
        <div className="grid gap-0.5 border-t border-ink-700 pt-2">
          {isMe ? (
            <Action icon={<Shield size={15} />} label="Modifier mon profil" onClick={() => openModal({ kind: 'userSettings', tab: 'profile' })} />
          ) : (
            <>
              <Action icon={<MessageCircle size={15} />} label="Envoyer un message" onClick={() => openDmWith(userId)} />
              {relation === 'friend' && <Action icon={<Phone size={15} />} label="Appeler" onClick={() => openDmWith(userId, true)} />}
              {relation === 'friend' && <Action icon={<UserMinus size={15} />} label="Retirer l'ami" onClick={() => emit('friend:remove', { userId })} />}
              {relation === 'incoming' && <Action icon={<UserPlus size={15} />} label="Accepter la demande" onClick={() => emit('friend:accept', { userId })} />}
              {relation === 'outgoing' && <Action icon={<UserX size={15} />} label="Annuler la demande" onClick={() => emit('friend:remove', { userId })} />}
              {!relation && <Action icon={<UserPlus size={15} />} label="Ajouter en ami" onClick={async () => { await emit('friend:request', { username: user.username }); toast("Demande d'ami envoyée.", 'success'); }} />}
              {relation === 'blocked'
                ? <Action icon={<UserX size={15} />} label="Débloquer" onClick={() => emit('user:unblock', { userId })} />
                : <Action icon={<UserX size={15} />} label="Bloquer" danger onClick={() => emit('user:block', { userId })} />}
              <Action icon={<Flag size={15} />} label="Signaler" danger onClick={() => openModal({ kind: 'report', userId, serverId })} />
            </>
          )}
        </div>
        {server && member && (has(perms, P.MANAGE_ROLES) || (canMod && (has(perms, P.MODERATE_MEMBERS) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS)))) && (
          <div className="grid gap-0.5 border-t border-ink-700 pt-2">
            <div className="section-title px-2 pb-1">Modération</div>
            {has(perms, P.MANAGE_ROLES) && (canMod || isMe) && <Action icon={<Shield size={15} />} label="Gérer les rôles" onClick={() => openModal({ kind: 'serverSettings', serverId: server.id, tab: 'members' })} />}
            {canMod && has(perms, P.MODERATE_MEMBERS) && (
              <>
                <Action icon={<MicOff size={15} />} label={member.voiceMuted ? 'Rendre la parole en vocal' : 'Rendre muet en vocal'} onClick={() => emit('member:voice-mute', { serverId: server.id, userId, muted: !member.voiceMuted })} />
                {inMyVoice && <Action icon={<PhoneOff size={15} />} label="Déconnecter du vocal" onClick={() => emit('member:voice-disconnect', { serverId: server.id, userId })} />}
                <Action icon={<Clock size={15} />} label={member.mutedUntil ? "Lever l'exclusion" : 'Exclure temporairement'}
                  onClick={() => (member.mutedUntil ? emit('member:timeout', { serverId: server.id, userId, minutes: 0 }) : openModal({ kind: 'moderate', serverId: server.id, userId, action: 'timeout' }))} />
              </>
            )}
            {canMod && has(perms, P.KICK_MEMBERS) && <Action icon={<UserMinus size={15} />} label={`Expulser ${displayName(userId, serverId)}`} danger onClick={() => openModal({ kind: 'moderate', serverId: server.id, userId, action: 'kick' })} />}
            {canMod && has(perms, P.BAN_MEMBERS) && <Action icon={<Ban size={15} />} label={`Bannir ${displayName(userId, serverId)}`} danger onClick={() => openModal({ kind: 'moderate', serverId: server.id, userId, action: 'ban' })} />}
          </div>
        )}
      </div>
    </div>
  );
}

export const closeAll = () => { closePopover(); closeModal(); };
