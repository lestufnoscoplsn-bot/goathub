import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, disconnect, emit, uploadFile } from '../../lib/socket';
import { closeModal, openModal, set, toast, useStore } from '../../lib/store';
import { askPermission, settings as notifSettings } from '../../lib/notify';
import { local } from '../../lib/storage';
import { sounds } from '../../lib/sounds';
import { cx } from '../../lib/format';
import { audioSettings, voice, type AudioSettings } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { Field, Modal } from '../ui/Modal';
import { Reports } from './ServerSettings';
import { SettingsLayout } from './SettingsLayout';

const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast(ok, 'success')).catch((e) => toast(e.message, 'error'));

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 py-2">
      <span className="flex-1"><span className="block font-medium">{label}</span>{hint && <span className="block text-sm text-zinc-500">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform', checked ? 'bg-brand-500 after:translate-x-5' : 'bg-ink-500')} />
    </label>
  );
}

function Account() {
  const me = useStore((s) => s.me!);
  const [username, setUsername] = useState(me.username);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await emit<{ loggedOut: number }>('account:password', { current, next });
      setCurrent(''); setNext('');
      toast(`Mot de passe changé.${res.loggedOut ? ` ${res.loggedOut} autre(s) appareil(s) déconnecté(s).` : ''}`, 'success');
    } catch (err) { toast((err as Error).message, 'error'); }
  };
  return (
    <div className="max-w-xl space-y-8">
      <div className="space-y-4">
        <Field label="Pseudo (2 à 16 caractères)">
          <div className="flex gap-2"><input className="input" value={username} maxLength={16} onChange={(e) => setUsername(e.target.value)} />
            <button className="btn-primary" disabled={username === me.username} onClick={() => run(emit('profile:update', { username }), 'Pseudo modifié.')}>Enregistrer</button></div>
        </Field>
        <Field label="E-mail" hint="Ton e-mail est chiffré et n'est jamais montré aux autres."><input className="input" value={me.email} disabled /></Field>
      </div>
      <form onSubmit={changePassword} className="space-y-4">
        <h3 className="text-lg font-bold">Changer de mot de passe</h3>
        <Field label="Mot de passe actuel"><input type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum, avec des lettres et des chiffres. Tes autres appareils seront déconnectés.">
          <input type="password" className="input" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={200} />
        </Field>
        <button className="btn-primary">Changer le mot de passe</button>
      </form>
    </div>
  );
}

function Profile() {
  const me = useStore((s) => s.me!);
  const [bio, setBio] = useState(me.bio);
  const [customStatus, setCustomStatus] = useState(me.customStatus);
  const [accent, setAccent] = useState(me.accentColor);
  return (
    <div className="grid max-w-3xl gap-8 lg:grid-cols-[1fr_280px]">
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar user={me} size={80} />
          <label className="btn-primary cursor-pointer">Changer l'avatar
            <input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await run(uploadFile(f).then((up) => emit('profile:update', { avatarId: up.id })), 'Avatar mis à jour.');
            }} />
          </label>
          {me.avatar && <button className="btn-ghost" onClick={() => run(emit('profile:update', { avatarId: null }))}>Retirer</button>}
        </div>
        <Field label="Statut personnalisé"><input className="input" value={customStatus} maxLength={80} onChange={(e) => setCustomStatus(e.target.value)} placeholder="Ex : en train de jouer" /></Field>
        <Field label="À propos de moi"><textarea className="input" rows={4} value={bio} maxLength={190} onChange={(e) => setBio(e.target.value)} /></Field>
        <Field label="Couleur de profil"><input type="color" className="h-10 w-20 cursor-pointer rounded-lg border border-ink-600 bg-ink-900" value={accent} onChange={(e) => setAccent(e.target.value)} /></Field>
        <button className="btn-primary" onClick={() => run(emit('profile:update', { bio, customStatus, accentColor: accent }), 'Profil enregistré.')}>Enregistrer</button>
      </div>
      <div className="h-fit overflow-hidden rounded-2xl border border-ink-600 bg-ink-900">
        <div className="h-16" style={{ background: `linear-gradient(135deg, ${accent}, #c026d3)` }} />
        <div className="-mt-9 px-4"><div className="inline-block rounded-full border-4 border-ink-900"><Avatar user={me} size={64} /></div></div>
        <div className="space-y-1 p-4 pt-1"><div className="font-bold">{me.username}</div><div className="text-sm">{customStatus}</div><p className="whitespace-pre-wrap text-sm text-zinc-400">{bio}</p></div>
      </div>
    </div>
  );
}

interface SecurityState {
  twoFactor: boolean; recoveryLeft: number;
  sessions: { id: number; device: string; network: string; createdAt: string; lastSeen: string; current: boolean }[];
  events: { kind: string; details: string; at: string }[];
}
const EVENT_LABEL: Record<string, string> = { login: 'Connexion', new_device: '⚠️ Nouvel appareil', failed: '⚠️ Tentative échouée', password: 'Mot de passe', '2fa': 'Double authentification', recovery_code: 'Code de secours', revoked: 'Déconnexion à distance' };

export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <Modal onClose={closeModal} label="Codes de secours">
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-bold">Tes codes de secours</h2>
        <p className="text-sm text-zinc-400">Si tu perds ton téléphone, chacun de ces codes permet de te connecter <b className="text-zinc-200">une seule fois</b>. Note-les dans un endroit sûr : ils ne seront plus jamais affichés.</p>
        <div className="grid grid-cols-2 gap-2">{codes.map((c) => <code key={c} className="select-all rounded-lg bg-ink-950 p-2 text-center font-mono">{c}</code>)}</div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Codes copiés.', 'success'))}>Copier</button>
          <button className="btn-primary" onClick={() => openModal({ kind: 'userSettings', tab: 'security' })}>C'est noté</button>
        </div>
      </div>
    </Modal>
  );
}

function TwoFactorSetup({ onDone }: { onDone: (codes: string[]) => void }) {
  const [step, setStep] = useState<'password' | 'scan'>('password');
  const [password, setPassword] = useState('');
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return step === 'password' ? (
    <form className="space-y-3 rounded-xl bg-ink-850 p-4" onSubmit={async (e) => {
      e.preventDefault();
      try { setQr(await emit('2fa:setup', { password })); setStep('scan'); setError(''); } catch (err) { setError((err as Error).message); }
    }}>
      <Field label="Confirme ton mot de passe"><input type="password" className="input" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn-primary">Continuer</button>
    </form>
  ) : (
    <form className="space-y-3 rounded-xl bg-ink-850 p-4" onSubmit={async (e) => {
      e.preventDefault();
      try { const r = await emit<{ recoveryCodes: string[] }>('2fa:enable', { code }); onDone(r.recoveryCodes); } catch (err) { setError((err as Error).message); }
    }}>
      <p className="text-sm text-zinc-300">1. Dans ton application d'authentification (Google Authenticator, Aegis, 2FAS…), ajoute un compte et scanne ce QR code :</p>
      <img src={qr!.qr} alt="QR code à scanner" width={200} height={200} className="mx-auto rounded-lg bg-white p-2" />
      <p className="text-center text-xs text-zinc-500">Impossible de scanner ? Tape cette clé : <code className="select-all text-zinc-300">{qr!.secret}</code></p>
      <Field label="2. Entre le code à 6 chiffres affiché"><input className="input text-center text-lg tracking-[0.4em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code à 6 chiffres" /></Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn-primary" disabled={code.length !== 6}>Activer</button>
    </form>
  );
}

function Security() {
  const [state, setState] = useState<SecurityState | null>(null);
  const [setup, setSetup] = useState(false);
  const [disable, setDisable] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const reload = () => emit<SecurityState>('security:status').then(setState).catch((e) => toast(e.message, 'error'));
  useEffect(() => { void reload(); }, []);
  if (!state) return <p className="text-zinc-500">Chargement…</p>;
  const date = (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-3">
        <h3 className="text-lg font-bold">Double authentification (2FA)</h3>
        {state.twoFactor ? (
          <>
            <p className="text-sm"><b className="text-ok">✓ Activée.</b> Un code de ton téléphone est demandé à chaque connexion. Codes de secours restants : {state.recoveryLeft}.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => openModal({ kind: 'prompt', title: 'Nouveaux codes de secours', text: 'Les anciens codes ne marcheront plus.', label: 'Ton mot de passe', confirm: 'Créer',
                onSubmit: async (pw) => { const r = await emit<{ recoveryCodes: string[] }>('2fa:recovery', { password: pw }); openModal({ kind: 'recoveryCodes', codes: r.recoveryCodes }); } })}>
                Nouveaux codes de secours
              </button>
              <button className="btn-ghost text-bad" onClick={() => setDisable(!disable)}>Désactiver</button>
            </div>
            {disable && (
              <form className="space-y-3 rounded-xl bg-ink-850 p-4" onSubmit={async (e) => {
                e.preventDefault();
                try { await emit('2fa:disable', { password, code }); toast('Double authentification désactivée.'); setDisable(false); void reload(); } catch (err) { toast((err as Error).message, 'error'); }
              }}>
                <Field label="Mot de passe"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <Field label="Code à 6 chiffres"><input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <button className="btn-danger">Désactiver la double authentification</button>
              </form>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-400">Même si quelqu'un découvre ton mot de passe, il lui faudra aussi le code à 6 chiffres affiché sur ton téléphone.</p>
            {setup ? <TwoFactorSetup onDone={(c) => { setSetup(false); openModal({ kind: 'recoveryCodes', codes: c }); }} /> : <button className="btn-primary" onClick={() => setSetup(true)}>Activer la double authentification</button>}
          </>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Appareils connectés</h3>
          {state.sessions.length > 1 && <button className="btn-ghost text-bad" onClick={() => emit<{ count: number }>('sessions:revoke-others').then((r) => { toast(`${r.count} appareil(s) déconnecté(s).`, 'success'); void reload(); }).catch((e) => toast(e.message, 'error'))}>Déconnecter les autres</button>}
        </div>
        <div className="divide-y divide-ink-700 rounded-xl border border-ink-600">
          {state.sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3">
              <div className="flex-1">
                <div className="font-medium">{s.device || 'Appareil'} {s.current && <span className="chip ml-1 bg-ok/20 text-ok">cet appareil</span>}</div>
                <div className="text-xs text-zinc-500">Réseau {s.network} · connecté le {date(s.createdAt)} · actif le {date(s.lastSeen)}</div>
              </div>
              {!s.current && <button className="btn-ghost py-1.5 text-bad" onClick={() => emit('session:revoke', { id: s.id }).then(reload).catch((e) => toast(e.message, 'error'))}>Déconnecter</button>}
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-lg font-bold">Activité récente</h3>
        <div className="divide-y divide-ink-700 rounded-xl border border-ink-600 text-sm">
          {!state.events.length && <p className="p-3 text-zinc-500">Rien à signaler.</p>}
          {state.events.map((e, i) => (
            <div key={i} className="grid grid-cols-[130px_170px_1fr] gap-2 p-2.5">
              <span className="text-xs text-zinc-500">{date(e.at)}</span>
              <b className={/new_device|failed/.test(e.kind) ? 'text-warn' : ''}>{EVENT_LABEL[e.kind] ?? e.kind}</b>
              <span className="text-zinc-400">{e.details}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Indicateur de niveau du micro (pour tester ses réglages). */
function MicTest({ settings }: { settings: AudioSettings }) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const loop = useRef(0);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.inputId === 'default' ? undefined : { exact: settings.inputId }, noiseSuppression: settings.noiseSuppression, echoCancellation: settings.echoCancellation, autoGainControl: settings.autoGain } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += (v - 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) / 40));
          loop.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => { toast("Impossible d'accéder au micro.", 'error'); setOn(false); });
    return () => { cancelled = true; cancelAnimationFrame(loop.current); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close(); setLevel(0); };
  }, [on, settings]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button className={on ? 'btn-danger' : 'btn-primary'} onClick={() => setOn(!on)}>{on ? 'Arrêter le test' : 'Tester mon micro'}</button>
        <button className="btn-ghost" onClick={() => sounds.join()}>Tester les haut-parleurs</button>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-ink-700" aria-label="Niveau du micro"><div className="h-full rounded-full bg-gradient-to-r from-ok to-warn transition-[width] duration-75" style={{ width: `${level * 100}%` }} /></div>
      <p className="text-xs text-zinc-500">Parle : la barre doit bouger. Si elle reste vide, choisis un autre micro.</p>
    </div>
  );
}

function VoiceAudio() {
  const [s, setS] = useState(audioSettings());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = async () => {
    try {
      // Les noms des appareils ne sont visibles qu'après avoir autorisé le micro une fois
      const list = await navigator.mediaDevices.enumerateDevices();
      if (!list.some((d) => d.label)) {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        setDevices(await navigator.mediaDevices.enumerateDevices());
      } else setDevices(list);
    } catch { toast('Autorise le micro pour choisir tes appareils.', 'error'); }
  };
  useEffect(() => { void refresh(); }, []);
  const update = (patch: Partial<AudioSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void voice.applyAudioSettings(next);
  };
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Micro">
          <select className="input" value={s.inputId} onChange={(e) => update({ inputId: e.target.value })}>
            {!inputs.some((d) => d.deviceId === 'default') && <option value="default">Par défaut</option>}
            {inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micro'}</option>)}
          </select>
        </Field>
        <Field label="Haut-parleurs / casque">
          <select className="input" value={s.outputId} onChange={(e) => update({ outputId: e.target.value })} disabled={!outputs.length}>
            {!outputs.some((d) => d.deviceId === 'default') && <option value="default">Par défaut</option>}
            {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Sortie audio'}</option>)}
          </select>
        </Field>
      </div>
      <MicTest settings={s} />
      <div className="divide-y divide-ink-700">
        <Toggle label="Réduction de bruit" hint="Atténue les bruits de fond (clavier, ventilateur…)." checked={s.noiseSuppression} onChange={(v) => update({ noiseSuppression: v })} />
        <Toggle label="Annulation d'écho" hint="Évite que les autres s'entendent eux-mêmes si tu n'as pas de casque." checked={s.echoCancellation} onChange={(v) => update({ echoCancellation: v })} />
        <Toggle label="Réglage automatique du volume du micro" checked={s.autoGain} onChange={(v) => update({ autoGain: v })} />
      </div>
      <p className="text-sm text-zinc-500">Pour régler le volume d'une personne en particulier : en vocal, clique sur son nom (ou clic droit sur sa vignette).</p>
    </div>
  );
}

function Notifications() {
  const [desktop, setDesktop] = useState(notifSettings.desktop);
  const [sound, setSound] = useState(notifSettings.sound);
  return (
    <div className="max-w-xl divide-y divide-ink-700">
      <Toggle label="Notifications du bureau" hint="Messages privés, mentions, appels et demandes d'ami quand GoatHub est en arrière-plan." checked={desktop}
        onChange={async (v) => {
          if (v && !(await askPermission())) return toast('Les notifications sont bloquées par ton navigateur.', 'error');
          setDesktop(v); local.set('notif:desktop', v);
        }} />
      <Toggle label="Sons" hint="Nouveau message, mention, appel." checked={sound} onChange={(v) => { setSound(v); local.set('notif:sound', v); }} />
      <p className="pt-3 text-sm text-zinc-500">En statut « Occupé », aucune notification ni sonnerie n'est émise.</p>
    </div>
  );
}

export function UserSettings({ initialTab }: { initialTab?: string }) {
  const me = useStore((s) => s.me!);
  const logout = async () => {
    closeModal();
    await voice.leave(true);
    await api('/api/auth/logout', {}).catch(() => {});
    disconnect();
    set({ phase: 'auth', me: null, servers: {}, serverOrder: [], dms: [], messages: {} });
  };
  const tabs = [
    { id: 'account', label: 'Mon compte', render: () => <Account /> },
    { id: 'profile', label: 'Profil', render: () => <Profile /> },
    { id: 'security', label: 'Sécurité', render: () => <Security /> },
    { id: 'voice', label: 'Voix et audio', render: () => <VoiceAudio /> },
    { id: 'notifications', label: 'Notifications', render: () => <Notifications /> },
    ...(me.isAdmin ? [{ id: 'admin', label: 'Administration du site', render: () => <><p className="mb-4 text-sm text-zinc-400">Tous les signalements envoyés sur le site.</p><Reports /></> }] : []),
    { id: 'logout', label: 'Déconnexion', danger: true, render: () => null, onClick: () => openModal({ kind: 'confirm', title: 'Se déconnecter ?', text: 'Tu devras te reconnecter sur cet appareil.', confirm: 'Déconnexion', danger: true, onConfirm: logout }) },
  ];
  return (
    <Modal onClose={closeModal} wide className="h-[min(760px,calc(100vh-2rem))] overflow-hidden p-0" label="Paramètres">
      <SettingsLayout title="Paramètres" tabs={tabs} initialTab={initialTab} />
    </Modal>
  );
}
