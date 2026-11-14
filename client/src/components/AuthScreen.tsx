import { ArrowRight, AtSign, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { cx } from '../lib/format';
import { connect, api } from '../lib/socket';
import { useStore } from '../lib/store';
import { local } from '../lib/storage';
import { Logo } from './Logo';

interface InvitePreview { server: { name: string }; memberCount: number; onlineCount: number; iconUrl: string | null }

function strength(pw: string) {
  if (!pw) return 0;
  if (pw.length < 8) return 1;
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
const STRENGTH_COLORS = ['', 'bg-bad', 'bg-warn', 'bg-brand-400', 'bg-ok'];

function Input({ icon, right, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-750 px-3.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25">
      <span className="text-zinc-400">{icon}</span>
      <input {...props} className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-white outline-none placeholder:text-zinc-500" />
      {right}
    </div>
  );
}

export function AuthScreen({ inviteCode }: { inviteCode?: string }) {
  const config = useStore((s) => s.config);
  const [mode, setMode] = useState<'register' | 'login'>(local.get('known', false) ? 'login' : 'register');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InvitePreview | null>(null);

  useEffect(() => {
    if (inviteCode) api<InvitePreview>(`/api/invites/${inviteCode}`).then(setInvite).catch(() => {});
  }, [inviteCode]);

  const register = mode === 'register';
  const score = strength(password);

  function check(): string | null {
    if (register && !/^[\p{L}\p{N}_.-]{2,16}$/u.test(username.trim())) return 'Le pseudo doit faire 2 à 16 caractères (lettres, chiffres, _ . -).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return 'Adresse e-mail invalide.';
    if (register && config.signupCodeRequired && !signupCode.trim()) return "Indique le code d'inscription.";
    if (!password) return 'Indique ton mot de passe.';
    if (register && password.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
    if (register && (!/\p{L}/u.test(password) || !/\d/.test(password))) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setBusy(true);
      if (ticket) {
        await api('/api/auth/2fa', { ticket, code });
      } else {
        const problem = check();
        if (problem) return setError(problem);
        const res = await api<{ twoFactor?: boolean; ticket?: string }>(register ? '/api/auth/register' : '/api/auth/login',
          register ? { email, username, password, signupCode } : { email, password });
        if (res.twoFactor) {
          setTicket(res.ticket!);
          return;
        }
      }
      local.set('known', true);
      if (inviteCode) useStore.setState({ pendingInvite: inviteCode });
      useStore.setState({ phase: 'loading' });
      connect();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (ticket && status === 401) { setTicket(null); setCode(''); }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center overflow-y-auto bg-ink-950 p-4"
      style={{ backgroundImage: 'radial-gradient(600px 400px at 15% 10%, rgba(123,92,255,.22), transparent 70%), radial-gradient(500px 420px at 90% 95%, rgba(192,38,211,.16), transparent 70%)' }}>
      <form onSubmit={submit} noValidate className="w-full max-w-[480px] animate-pop-in rounded-[26px] border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-850 p-6 shadow-pop sm:p-7">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size={48} />
            <div>
              <div className="text-lg font-bold">GoatHub</div>
              <div className="max-w-[210px] text-xs leading-snug text-zinc-400">Espace de communication nouvelle génération</div>
            </div>
          </div>
          {!ticket && (
            <div className="flex rounded-full border border-ink-600 bg-ink-900 p-1" role="tablist">
              {(['register', 'login'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(''); }}
                  className={cx('rounded-full px-4 py-1.5 text-sm font-semibold transition-all',
                    mode === m ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-glow' : 'text-zinc-400 hover:text-white')}>
                  {m === 'register' ? 'Inscription' : 'Connexion'}
                </button>
              ))}
            </div>
          )}
        </header>

        {invite && (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3">
            <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-ink-700 font-bold">
              {invite.iconUrl ? <img src={invite.iconUrl} alt="" className="h-full w-full object-cover" /> : invite.server.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="text-sm">
              <div className="text-zinc-400">Tu as été invité à rejoindre</div>
              <div className="font-bold text-white">{invite.server.name}</div>
              <div className="text-xs text-zinc-400"><span className="text-ok">●</span> {invite.onlineCount} en ligne · {invite.memberCount} membres</div>
            </div>
          </div>
        )}

        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
          {ticket ? 'Double authentification' : register ? 'Créer ton passeport GoatHub' : 'Content de te revoir !'}
        </h1>
        <p className="mb-5 mt-1 text-[15px] text-zinc-400">
          {ticket ? "Entre le code à 6 chiffres de ton application d'authentification, ou un code de secours."
            : register ? 'Choisis ton identité unique pour rejoindre les capsules vocales et flux.' : 'Connecte-toi pour retrouver tes serveurs et tes amis.'}
        </p>

        <div className="space-y-4">
          {ticket ? (
            <div>
              <label className="label" htmlFor="code">Code de vérification</label>
              <Input id="code" icon={<ShieldCheck size={18} />} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus />
            </div>
          ) : (
            <>
              {register && (
                <div>
                  <div className="flex justify-between"><label className="label" htmlFor="username">Pseudo</label><span className="text-xs text-zinc-500">2 à 16 caractères</span></div>
                  <Input id="username" icon={<AtSign size={18} />} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={16} autoComplete="username" spellCheck={false} autoFocus />
                </div>
              )}
              <div>
                <label className="label" htmlFor="email">Adresse e-mail</label>
                <Input id="email" type="email" icon={<Mail size={18} />} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} autoFocus={!register} />
              </div>
              {register && config.signupCodeRequired && (
                <div>
                  <label className="label" htmlFor="signup">Code d'inscription</label>
                  <Input id="signup" icon={<KeyRound size={18} />} value={signupCode} onChange={(e) => setSignupCode(e.target.value)} autoComplete="off" />
                </div>
              )}
              <div>
                <div className="flex justify-between"><label className="label" htmlFor="password">Mot de passe</label>{register && <span className="text-xs text-zinc-500">8 caractères min., lettres et chiffres</span>}</div>
                <Input id="password" type={showPw ? 'text' : 'password'} icon={<Lock size={18} />} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={register ? 'new-password' : 'current-password'} maxLength={200}
                  right={<button type="button" className="text-zinc-400 hover:text-white" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{showPw ? <EyeOff size={18} /> : <Eye size={18} />}</button>} />
                {register && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden>
                    {[1, 2, 3, 4].map((i) => <span key={i} className={cx('h-1 rounded-full transition-colors', i <= score ? STRENGTH_COLORS[score] : 'bg-ink-600')} />)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 via-[#9b3df0] to-fuchsia-500 py-3.5 font-bold text-white shadow-[0_12px_30px_rgba(155,61,240,.35)] transition hover:brightness-110 active:scale-[.99] disabled:opacity-60">
          {busy ? 'Un instant…' : ticket ? 'Vérifier' : register ? 'Créer mon compte' : 'Se connecter'} <ArrowRight size={18} />
        </button>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 pt-4 text-sm text-zinc-400">
          {ticket ? (
            <><span>Pas le bon compte ?</span><button type="button" className="font-semibold text-brand-400 hover:text-brand-300" onClick={() => { setTicket(null); setError(''); }}>← Revenir</button></>
          ) : (
            <>
              <span>{register ? 'Déjà un passeport GoatHub ?' : 'Pas encore de passeport ?'}</span>
              <button type="button" className="font-semibold text-brand-400 hover:text-brand-300" onClick={() => { setMode(register ? 'login' : 'register'); setError(''); }}>
                {register ? 'Se connecter →' : 'Créer un compte →'}
              </button>
            </>
          )}
        </footer>
      </form>
    </div>
  );
}
