// Page d'un salon vocal de serveur.
import { Volume2 } from 'lucide-react';
import { useStore, NO_VOICE } from '../../lib/store';
import { has, P, permissionsIn } from '../../lib/permissions';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { VoiceControls } from './Controls';
import { Stage } from './Stage';

export function VoiceView({ channelId, serverId }: { channelId: number; serverId: number }) {
  const server = useStore((s) => s.servers[serverId]);
  const me = useStore((s) => s.me!.id);
  const users = useStore((s) => s.voiceStates[channelId] ?? NO_VOICE);
  const all = useStore((s) => s.users);
  const v = useStore((s) => s.voice);
  const channel = server?.channels.find((c) => c.id === channelId);
  if (!channel) return null;
  const connected = v.channelId === channelId;
  const canConnect = has(permissionsIn(server, me), P.CONNECT);
  const full = channel.userLimit > 0 && users.length >= channel.userLimit;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ink-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-800 pl-12 pr-4 md:pl-4">
        <Volume2 size={20} className="text-zinc-500" /><h1 className="font-bold">{channel.name}</h1>
        <span className="text-sm text-zinc-500">· {users.length} {users.length > 1 ? 'personnes' : 'personne'}{channel.userLimit ? ` / ${channel.userLimit}` : ''}</span>
      </header>
      <div className="min-h-0 flex-1">
        {connected || users.length ? <Stage channelId={channelId} serverId={serverId} /> : null}
        {!connected && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            {!users.length && <div className="grid h-20 w-20 place-items-center rounded-full bg-ink-800"><Volume2 size={36} className="text-zinc-400" /></div>}
            <div>
              <h2 className="text-2xl font-bold">{channel.name}</h2>
              <p className="text-zinc-400">{users.length ? 'Ils sont déjà là :' : "Personne n'est là pour l'instant."}</p>
            </div>
            {users.length > 0 && <div className="flex -space-x-2">{users.slice(0, 8).map((u) => <Avatar key={u.userId} user={all[u.userId]} size={36} className="rounded-full ring-4 ring-ink-950" />)}</div>}
            <button className="btn-primary px-6 py-3 text-base" disabled={!canConnect || full || v.connecting} onClick={() => voice.join(channelId)}>
              {v.connecting && v.channelId === channelId ? 'Connexion…' : !canConnect ? 'Accès refusé' : full ? 'Salon plein' : 'Rejoindre le vocal'}
            </button>
          </div>
        )}
      </div>
      {connected && <div className="shrink-0 border-t border-ink-800 bg-ink-900/60 py-3"><VoiceControls /></div>}
    </div>
  );
}
