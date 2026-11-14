import { useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { Shell } from './components/layout/Shell';
import { Logo } from './components/Logo';
import { api, connect } from './lib/socket';
import { useRoute } from './lib/router';
import { useStore } from './lib/store';

export function App() {
  const phase = useStore((s) => s.phase);
  const route = useRoute();

  useEffect(() => {
    api<{ signupCodeRequired: boolean; maxUploadMb: number }>('/api/config').then((config) => useStore.setState({ config })).catch(() => {});
    connect();
  }, []);

  if (phase === 'auth') return <AuthScreen inviteCode={route.name === 'invite' ? route.code : undefined} />;
  if (phase === 'ready') return <Shell />;
  return (
    <div className="grid h-full place-items-center bg-ink-950">
      <div className="flex flex-col items-center gap-4 text-zinc-400">
        <div className="animate-pulse"><Logo size={64} /></div>
        {phase === 'offline'
          ? <><p>Impossible de joindre GoatHub.</p><button className="btn-primary" onClick={() => location.reload()}>Réessayer</button></>
          : <p>Connexion…</p>}
      </div>
    </div>
  );
}
