// Page d'un lien d'invitation : aperçu du serveur et bouton « Rejoindre ».
import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { api, emit } from '../lib/socket';
import { toast, upsertServer, useStore } from '../lib/store';
import type { Server, VoiceUser } from '../lib/types';
import { ServerIcon } from './ui/Avatar';

export function InviteView({ code }: { code: string }) {
  const [preview, setPreview] = useState<{ server: { id: number; name: string }; memberCount: number; onlineCount: number; iconUrl: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const already = useStore((s) => (preview ? !!s.servers[preview.server.id] : false));
  useEffect(() => { api(`/api/invites/${code}`).then(setPreview).catch((e) => setError(e.message)); }, [code]);
  const join = async () => {
    setBusy(true);
    try {
      const res = await emit<{ serverId: number; server?: Server; voiceStates?: Record<number, VoiceUser[]> }>('invite:join', { code });
      if (res.server) upsertServer(res.server);
      if (res.voiceStates) useStore.setState((s) => ({ voiceStates: { ...s.voiceStates, ...res.voiceStates } }));
      toast(`Bienvenue sur ${res.server?.name ?? preview?.server.name} !`, 'success');
      navigate(`/channels/${res.serverId}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid flex-1 place-items-center bg-ink-900 p-6" style={{ backgroundImage: 'radial-gradient(500px 300px at 50% 30%, rgba(123,92,255,.18), transparent 70%)' }}>
      <div className="card w-full max-w-sm animate-pop-in p-6 text-center">
        {error ? <><h1 className="text-xl font-bold">Invitation invalide</h1><p className="mt-2 text-zinc-400">{error}</p><button className="btn-ghost mt-5" onClick={() => navigate('/channels/@me')}>Retour</button></>
          : !preview ? <p className="text-zinc-400">Chargement…</p> : (
            <>
              <ServerIcon name={preview.server.name} icon={preview.iconUrl} size={80} className="mx-auto rounded-3xl" />
              <p className="mt-4 text-sm text-zinc-400">Tu as été invité à rejoindre</p>
              <h1 className="text-2xl font-extrabold">{preview.server.name}</h1>
              <p className="mt-1 text-sm text-zinc-400"><span className="text-ok">●</span> {preview.onlineCount} en ligne · {preview.memberCount} membres</p>
              <button className="btn-primary mt-6 w-full py-3" disabled={busy} onClick={already ? () => navigate(`/channels/${preview.server.id}`) : join}>
                {already ? 'Ouvrir le serveur' : busy ? 'Un instant…' : 'Rejoindre le serveur'}
              </button>
            </>
          )}
      </div>
    </div>
  );
}
