import { Copy, Hash, ImagePlus, Link2, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { navigate } from '../../lib/router';
import { emit, uploadFile } from '../../lib/socket';
import { closeModal, displayName, toast, upsertDm, upsertServer, useStore, type Modal as ModalT } from '../../lib/store';
import { cx } from '../../lib/format';
import type { Dm, Server, VoiceUser } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Field, Modal } from '../ui/Modal';
import { ServerSettings } from '../settings/ServerSettings';
import { RecoveryCodes, UserSettings } from '../settings/UserSettings';

/** Petit formulaire générique : titre, champs, erreur, boutons. */
function FormModal({ title, text, children, onSubmit, confirm, danger, wide }: {
  title: string; text?: ReactNode; children?: ReactNode; onSubmit: () => Promise<unknown> | unknown; confirm: string; danger?: boolean; wide?: boolean;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const before = useStore.getState().modal;
      await onSubmit();
      if (useStore.getState().modal === before) closeModal(); // sauf si l'action a ouvert une autre fenêtre
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={closeModal} wide={wide} label={title}>
      <form onSubmit={submit}>
        <div className="space-y-4 p-6">
          <h2 className="pr-8 text-xl font-bold">{title}</h2>
          {text && <div className="text-sm text-zinc-400">{text}</div>}
          {children}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 rounded-b-2xl bg-ink-850 px-6 py-4">
          <button type="button" className="btn-ghost" onClick={closeModal}>Annuler</button>
          <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy}>{busy ? '…' : confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

function PromptModal({ m }: { m: Extract<ModalT, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(m.value ?? '');
  return (
    <FormModal title={m.title} text={m.text} confirm={m.confirm} onSubmit={() => {
      if (!value.trim() && !m.allowEmpty) throw new Error('Ce champ ne peut pas être vide.');
      return m.onSubmit(value.trim());
    }}>
      <Field label={m.label}><input autoFocus className="input" value={value} maxLength={m.maxLength ?? 100} onChange={(e) => setValue(e.target.value)} /></Field>
    </FormModal>
  );
}

function CreateServerModal() {
  const [step, setStep] = useState<'choose' | 'create' | 'join'>('choose');
  const [name, setName] = useState(`Le serveur de ${useStore.getState().me?.username}`);
  const [icon, setIcon] = useState<{ id: string; url: string } | null>(null);
  const [link, setLink] = useState('');
  if (step === 'choose') {
    return (
      <Modal onClose={closeModal} label="Créer ou rejoindre un serveur">
        <div className="p-6 text-center">
          <h2 className="text-2xl font-bold">Ton serveur</h2>
          <p className="mt-1 text-sm text-zinc-400">Un serveur, c'est l'endroit où toi et tes amis discutez, en texte et en vocal.</p>
          <div className="mt-6 space-y-3">
            <button className="flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-4 text-left transition hover:border-brand-500 hover:bg-ink-750" onClick={() => setStep('create')}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-xl">🐐</span>
              <span><b>Créer mon serveur</b><span className="block text-sm text-zinc-400">Pour mes amis, ma classe, mon équipe…</span></span>
            </button>
            <button className="flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-850 p-4 text-left transition hover:border-brand-500 hover:bg-ink-750" onClick={() => setStep('join')}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-ink-600"><Link2 size={20} /></span>
              <span><b>Rejoindre un serveur</b><span className="block text-sm text-zinc-400">J'ai un lien d'invitation</span></span>
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  if (step === 'join') {
    return (
      <FormModal title="Rejoindre un serveur" text="Colle le lien d'invitation que tu as reçu." confirm="Rejoindre" onSubmit={async () => {
        const code = link.trim().replace(/^.*\/invite\//, '').replace(/\/$/, '');
        if (!/^[A-Za-z0-9]{6,16}$/.test(code)) throw new Error("Ce lien d'invitation n'est pas valide.");
        const res = await emit<{ serverId: number; server?: Server; voiceStates?: Record<number, VoiceUser[]> }>('invite:join', { code });
        if (res.server) upsertServer(res.server);
        if (res.voiceStates) useStore.setState((s) => ({ voiceStates: { ...s.voiceStates, ...res.voiceStates } }));
        navigate(`/channels/${res.serverId}`);
      }}>
        <Field label="Lien d'invitation" hint="Exemple : https://goathub.exemple.fr/invite/aB3dE5fG">
          <input autoFocus className="input" value={link} onChange={(e) => setLink(e.target.value)} maxLength={200} />
        </Field>
      </FormModal>
    );
  }
  return (
    <FormModal title="Personnalise ton serveur" text="Donne-lui un nom et une icône. Tu pourras les changer plus tard." confirm="Créer" onSubmit={async () => {
      const server = await emit<Server>('server:create', { name, iconId: icon?.id ?? null });
      upsertServer(server);
      navigate(`/channels/${server.id}`);
    }}>
      <div className="flex justify-center">
        <label className="grid h-20 w-20 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-dashed border-ink-500 text-zinc-400 transition hover:border-brand-500 hover:text-brand-400">
          {icon ? <img src={icon.url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={26} />}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try { const up = await uploadFile(file); setIcon({ id: up.id, url: up.url }); } catch (err) { toast((err as Error).message, 'error'); }
          }} />
        </label>
      </div>
      <Field label="Nom du serveur"><input autoFocus className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
    </FormModal>
  );
}

function InviteModal({ serverId }: { serverId: number }) {
  const server = useStore((s) => s.servers[serverId]);
  const publicUrl = useStore((s) => s.publicUrl);
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState('168');
  const [maxUses, setMaxUses] = useState('0');
  const [custom, setCustom] = useState(false);
  useEffect(() => { emit<{ code: string }>('invite:default', { serverId }).then((r) => setCode(r.code)).catch((e) => toast(e.message, 'error')); }, [serverId]);
  const link = code ? `${publicUrl}/invite/${code}` : '…';
  const copy = () => navigator.clipboard.writeText(link).then(() => toast('Lien copié !', 'success')).catch(() => toast(link));
  const generate = async () => {
    try {
      const r = await emit<{ code: string }>('invite:create', { serverId, expiresInHours: expires === '0' ? null : Number(expires), maxUses: maxUses === '0' ? null : Number(maxUses) });
      setCode(r.code);
      setCustom(false);
      toast('Nouveau lien créé.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Modal onClose={closeModal} label="Inviter des amis">
      <div className="space-y-4 p-6">
        <h2 className="pr-8 text-xl font-bold">Inviter des amis sur {server?.name}</h2>
        <p className="text-sm text-zinc-400">Envoie ce lien à tes amis : en l'ouvrant, ils pourront rejoindre le serveur.</p>
        <div className="flex gap-2 rounded-xl border border-ink-600 bg-ink-950 p-1.5">
          <input readOnly value={link} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" aria-label="Lien d'invitation" onFocus={(e) => e.target.select()} />
          <button className="btn-primary" onClick={copy}><Copy size={16} /> Copier</button>
        </div>
        {!custom ? <button className="text-sm text-brand-400 hover:underline" onClick={() => setCustom(true)}>Créer un lien qui expire ou à usage limité</button> : (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-ink-850 p-3">
            <Field label="Expire après">
              <select className="input" value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="1">1 heure</option><option value="24">1 jour</option><option value="168">7 jours</option><option value="0">Jamais</option>
              </select>
            </Field>
            <Field label="Utilisations max.">
              <select className="input" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
                <option value="0">Illimité</option><option value="1">1</option><option value="5">5</option><option value="10">10</option><option value="50">50</option>
              </select>
            </Field>
            <button className="btn-primary col-span-2" onClick={generate}>Générer le lien</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateChannelModal({ serverId, type: initialType, categoryId }: { serverId: number; type?: 'text' | 'voice'; categoryId?: number | null }) {
  const server = useStore((s) => s.servers[serverId]);
  const [type, setType] = useState<'text' | 'voice'>(initialType ?? 'text');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(categoryId != null ? String(categoryId) : String(server?.categories.find((c) => /vocal/i.test(c.name) === (type === 'voice'))?.id ?? ''));
  return (
    <FormModal title="Créer un salon" confirm="Créer le salon" onSubmit={async () => {
      if (!name.trim()) throw new Error('Donne un nom au salon.');
      const ch = await emit<{ id: number }>('channel:create', { serverId, type, name, categoryId: category ? Number(category) : null });
      navigate(`/channels/${serverId}/${ch.id}`);
    }}>
      <div className="space-y-2">
        <span className="label">Type de salon</span>
        {([['text', <Hash key="t" size={22} />, 'Textuel', 'Messages, images, fichiers, émojis'], ['voice', <Volume2 key="v" size={22} />, 'Vocal', 'Discuter de vive voix, partager son écran']] as const).map(([t, icon, label, desc]) => (
          <label key={t} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition', type === t ? 'border-brand-500 bg-brand-500/10' : 'border-ink-600 bg-ink-850 hover:bg-ink-750')}>
            <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} className="accent-brand-500" />{icon}
            <span><b>{label}</b><span className="block text-xs text-zinc-400">{desc}</span></span>
          </label>
        ))}
      </div>
      <Field label="Nom du salon"><input autoFocus className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={type === 'text' ? 'nouveau-salon' : 'Salon vocal'} /></Field>
      <Field label="Catégorie">
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Aucune</option>
          {server?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
    </FormModal>
  );
}

function ChannelSettingsModal({ channelId, serverId }: { channelId: number; serverId: number }) {
  const server = useStore((s) => s.servers[serverId]);
  const channel = server?.channels.find((c) => c.id === channelId);
  const [name, setName] = useState(channel?.name ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [slowmode, setSlowmode] = useState(String(channel?.slowmode ?? 0));
  const [userLimit, setUserLimit] = useState(String(channel?.userLimit ?? 0));
  const [category, setCategory] = useState(String(channel?.categoryId ?? ''));
  if (!channel) return null;
  return (
    <FormModal title={`Modifier ${channel.type === 'text' ? '#' : ''}${channel.name}`} confirm="Enregistrer" onSubmit={() => emit('channel:update', {
      channelId, name, ...(channel.type === 'text' ? { topic, slowmode: Number(slowmode) } : { userLimit: Number(userLimit) }), categoryId: category ? Number(category) : null,
    })}>
      <Field label="Nom"><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      {channel.type === 'text' ? (
        <>
          <Field label="Sujet"><textarea className="input" rows={2} value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="De quoi parle-t-on ici ?" /></Field>
          <Field label="Mode lent (anti-spam)" hint="Délai entre deux messages d'une même personne. Les modérateurs ne sont pas concernés.">
            <select className="input" value={slowmode} onChange={(e) => setSlowmode(e.target.value)}>
              {[[0, 'Désactivé'], [5, '5 secondes'], [10, '10 secondes'], [30, '30 secondes'], [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 heure']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <Field label="Nombre maximum de personnes" hint="0 = illimité">
          <input type="number" min={0} max={99} className="input" value={userLimit} onChange={(e) => setUserLimit(e.target.value)} />
        </Field>
      )}
      <Field label="Catégorie">
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Aucune</option>
          {server.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <button type="button" className="text-sm text-bad hover:underline" onClick={() => useStore.setState({ modal: {
        kind: 'confirm', title: `Supprimer ${channel.name} ?`, text: 'Tous les messages de ce salon seront effacés. Cette action est définitive.', confirm: 'Supprimer', danger: true,
        onConfirm: () => emit('channel:delete', { channelId }),
      } })}>Supprimer le salon</button>
    </FormModal>
  );
}

const REASONS: [string, string][] = [['spam', 'Spam ou publicité'], ['harcelement', 'Harcèlement ou insultes'], ['contenu_choquant', 'Contenu choquant ou inapproprié'],
  ['arnaque', 'Arnaque ou tentative de vol de compte'], ['usurpation', "Se fait passer pour quelqu'un"], ['autre', 'Autre']];

function ReportModal({ userId, messageId, serverId }: { userId: number; messageId?: number; serverId?: number }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  return (
    <FormModal title={`Signaler ${displayName(userId, serverId)}`} confirm="Envoyer le signalement" danger
      text={messageId ? 'Le message signalé sera transmis aux modérateurs du serveur.' : serverId ? 'Le signalement sera transmis aux modérateurs du serveur.' : "Le signalement sera transmis à l'équipe du site."}
      onSubmit={async () => { await emit('report:create', { userId, messageId, serverId, reason, details }); toast('Merci, ton signalement a été envoyé.', 'success'); }}>
      <div className="space-y-1.5">
        {REASONS.map(([id, label]) => (
          <label key={id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', reason === id ? 'border-brand-500 bg-brand-500/10' : 'border-ink-600')}>
            <input type="radio" checked={reason === id} onChange={() => setReason(id)} className="accent-brand-500" />{label}
          </label>
        ))}
      </div>
      <Field label="Détails (facultatif)"><textarea className="input" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
    </FormModal>
  );
}

function NewGroupModal({ channelId }: { channelId?: number }) {
  const relations = useStore((s) => s.relations);
  const users = useStore((s) => s.users);
  const dm = useStore((s) => s.dms.find((d) => d.id === channelId));
  const friends = Object.entries(relations).filter(([, t]) => t === 'friend').map(([id]) => users[Number(id)]).filter(Boolean)
    .filter((u) => !dm?.recipients.some((r) => r.id === u.id));
  const [picked, setPicked] = useState<number[]>([]);
  const [filter, setFilter] = useState('');
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <FormModal title={channelId ? 'Ajouter au groupe' : 'Nouvelle conversation'} confirm={channelId ? 'Ajouter' : picked.length > 1 ? 'Créer le groupe' : 'Ouvrir'}
      text={channelId ? 'Choisis les amis à ajouter.' : 'Choisis un ami pour une conversation privée, ou plusieurs pour un groupe (10 personnes maximum).'}
      onSubmit={async () => {
        if (!picked.length) throw new Error('Choisis au moins un ami.');
        if (channelId) { for (const userId of picked) await emit('group:add', { channelId, userId }); return; }
        const res = picked.length === 1 ? await emit<Dm>('dm:open', { userId: picked[0] }) : await emit<Dm>('group:create', { userIds: picked });
        upsertDm(res);
        navigate(`/channels/@me/${res.id}`);
      }}>
      <input className="input" placeholder="Rechercher un ami" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Rechercher un ami" />
      <div className="max-h-72 space-y-0.5 overflow-y-auto">
        {!friends.length && <p className="text-sm text-zinc-500">Ajoute d'abord des amis depuis l'onglet « Amis ».</p>}
        {friends.filter((f) => f.username.toLowerCase().includes(filter.toLowerCase())).map((f) => (
          <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-750">
            <Avatar user={f} size={32} status /><span className="flex-1">{f.username}</span>
            <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4 accent-brand-500" />
          </label>
        ))}
      </div>
    </FormModal>
  );
}

function ModerateModal({ serverId, userId, action }: { serverId: number; userId: number; action: 'kick' | 'ban' | 'timeout' }) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('10');
  const [purge, setPurge] = useState('0');
  const name = displayName(userId, serverId);
  const title = action === 'kick' ? `Expulser ${name}` : action === 'ban' ? `Bannir ${name}` : `Exclure ${name} temporairement`;
  return (
    <FormModal title={title} danger confirm={action === 'kick' ? 'Expulser' : action === 'ban' ? 'Bannir' : 'Exclure'}
      text={action === 'kick' ? "Cette personne pourra revenir avec une nouvelle invitation." : action === 'ban' ? 'Cette personne ne pourra plus jamais rejoindre ce serveur (sauf si tu lèves le bannissement).'
        : 'Pendant ce temps, elle ne pourra ni écrire, ni réagir, ni parler en vocal.'}
      onSubmit={() => action === 'timeout' ? emit('member:timeout', { serverId, userId, minutes: Number(minutes), reason })
        : action === 'ban' ? emit('member:ban', { serverId, userId, reason, deleteMessagesHours: Number(purge) })
          : emit('member:kick', { serverId, userId, reason })}>
      {action === 'timeout' && (
        <Field label="Durée">
          <select className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[[1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [60, '1 heure'], [1440, '1 jour'], [10080, '1 semaine']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      )}
      {action === 'ban' && (
        <Field label="Supprimer ses messages récents">
          <select className="input" value={purge} onChange={(e) => setPurge(e.target.value)}>
            {[[0, 'Ne rien supprimer'], [1, 'Dernière heure'], [24, 'Dernières 24 heures'], [168, '7 derniers jours']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      )}
      <Field label="Raison (visible dans le journal)"><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'createServer': return <CreateServerModal />;
    case 'invite': return <InviteModal serverId={modal.serverId} />;
    case 'serverSettings': return <ServerSettings serverId={modal.serverId} initialTab={modal.tab} />;
    case 'userSettings': return <UserSettings initialTab={modal.tab} />;
    case 'channelSettings': return <ChannelSettingsModal channelId={modal.channelId} serverId={modal.serverId} />;
    case 'createChannel': return <CreateChannelModal serverId={modal.serverId} type={modal.type} categoryId={modal.categoryId} />;
    case 'report': return <ReportModal userId={modal.userId} messageId={modal.messageId} serverId={modal.serverId} />;
    case 'newGroup': return <NewGroupModal channelId={modal.channelId} />;
    case 'moderate': return <ModerateModal serverId={modal.serverId} userId={modal.userId} action={modal.action} />;
    case 'prompt': return <PromptModal m={modal} />;
    case 'recoveryCodes': return <RecoveryCodes codes={modal.codes} />;
    case 'confirm': return <FormModal title={modal.title} text={modal.text} confirm={modal.confirm} danger={modal.danger} onSubmit={modal.onConfirm} />;
    case 'image': return (
      <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/85 p-6" onClick={closeModal}>
        <img src={modal.url} alt={modal.name} className="max-h-[85vh] max-w-[92vw] animate-pop-in rounded-lg shadow-pop" />
        <a href={modal.url} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm text-zinc-300 hover:underline" onClick={(e) => e.stopPropagation()}>Ouvrir l'original</a>
      </div>
    );
  }
}
