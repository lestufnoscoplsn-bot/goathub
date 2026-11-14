// Page « Amis » : en ligne, tous, demandes en attente, bloqués, ajouter.
import { Check, MessageCircle, Phone, UserPlus, Users, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { emit } from '../lib/socket';
import { openModal, useStore } from '../lib/store';
import { cx, STATUS_LABEL } from '../lib/format';
import type { Relation } from '../lib/types';
import { Avatar } from './ui/Avatar';
import { openPopover } from './ui/Menu';
import { openDmWith, UserMenu } from './UserMenu';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('online');
  const relations = useStore((s) => s.relations);
  const users = useStore((s) => s.users);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = (type: Relation) => Object.entries(relations).filter(([, t]) => t === type).map(([id]) => Number(id)).filter((id) => users[id])
    .sort((a, b) => users[a].username.localeCompare(users[b].username));
  const incoming = ids('incoming');
  const run = (p: Promise<unknown>) => p.catch((e) => setMsg({ ok: false, text: e.message }));

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await emit('friend:request', { username: name.trim() });
      setMsg({ ok: true, text: `Demande envoyée à ${name.trim()} !` });
      setName('');
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  let list: { id: number; sub: string; actions: React.ReactNode }[] = [];
  let title = '';
  const iconBtn = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button key={label} title={label} aria-label={label} onClick={onClick}
      className={cx('grid h-9 w-9 place-items-center rounded-full bg-ink-850 text-zinc-300 transition', danger ? 'hover:text-bad' : 'hover:text-white')}>{icon}</button>
  );
  if (tab === 'online' || tab === 'all') {
    const friends = ids('friend').filter((id) => tab === 'all' || users[id].status !== 'offline');
    title = `${tab === 'online' ? 'En ligne' : 'Tous les amis'} — ${friends.length}`;
    list = friends.map((id) => ({
      id, sub: users[id].customStatus || STATUS_LABEL[users[id].status],
      actions: [iconBtn('Envoyer un message', <MessageCircle size={18} />, () => openDmWith(id)), iconBtn('Appeler', <Phone size={18} />, () => openDmWith(id, true)),
        iconBtn("Retirer l'ami", <X size={18} />, () => openModal({ kind: 'confirm', title: `Retirer ${users[id].username} ?`, text: 'Vous ne serez plus amis.', confirm: 'Retirer', danger: true, onConfirm: () => emit('friend:remove', { userId: id }) }), true)],
    }));
  } else if (tab === 'pending') {
    const outgoing = ids('outgoing');
    title = `En attente — ${incoming.length + outgoing.length}`;
    list = [
      ...incoming.map((id) => ({ id, sub: "Demande d'ami reçue", actions: [iconBtn('Accepter', <Check size={18} />, () => run(emit('friend:accept', { userId: id }))), iconBtn('Refuser', <X size={18} />, () => run(emit('friend:remove', { userId: id })), true)] })),
      ...outgoing.map((id) => ({ id, sub: "Demande d'ami envoyée", actions: [iconBtn('Annuler', <X size={18} />, () => run(emit('friend:remove', { userId: id })), true)] })),
    ];
  } else if (tab === 'blocked') {
    const blocked = ids('blocked');
    title = `Bloqués — ${blocked.length}`;
    list = blocked.map((id) => ({ id, sub: 'Bloqué', actions: [<button key="u" className="btn-ghost" onClick={() => run(emit('user:unblock', { userId: id }))}>Débloquer</button>] }));
  }

  const tabs: [Tab, string][] = [['online', 'En ligne'], ['all', 'Tous'], ['pending', 'En attente'], ['blocked', 'Bloqués']];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-ink-950/60 pl-12 pr-4 shadow-sm md:pl-4">
        <Users size={20} className="shrink-0 text-zinc-400" /><h1 className="font-bold">Amis</h1>
        <div className="mx-1 h-6 w-px shrink-0 bg-ink-600" />
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setMsg(null); }}
            className={cx('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition', tab === id ? 'bg-ink-600 text-white' : 'text-zinc-400 hover:bg-ink-700 hover:text-zinc-200')}>
            {label}{id === 'pending' && incoming.length > 0 && <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-white">{incoming.length}</span>}
          </button>
        ))}
        <button onClick={() => { setTab('add'); setMsg(null); }} className={cx('shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold transition', tab === 'add' ? 'text-ok' : 'bg-ok text-white hover:brightness-110')}>
          Ajouter un ami
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'add' ? (
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold">Ajouter un ami</h2>
            <p className="mb-4 text-sm text-zinc-400">Tu peux ajouter un ami avec son pseudo GoatHub.</p>
            <form onSubmit={add} className={cx('flex items-center gap-2 rounded-xl border bg-ink-950 p-2 transition', msg ? (msg.ok ? 'border-ok' : 'border-bad') : 'border-ink-600 focus-within:border-brand-500')}>
              <UserPlus size={20} className="ml-2 text-zinc-500" />
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} aria-label="Pseudo" placeholder="Pseudo de ton ami"
                className="min-w-0 flex-1 bg-transparent py-2 outline-none" />
              <button className="btn-primary" disabled={!name.trim()}>Envoyer une demande</button>
            </form>
            {msg && <p className={cx('mt-2 text-sm', msg.ok ? 'text-ok' : 'text-red-400')}>{msg.text}</p>}
          </div>
        ) : (
          <>
            <h2 className="section-title px-0 pb-3">{title}</h2>
            {msg && !msg.ok && <p className="mb-2 text-sm text-red-400">{msg.text}</p>}
            {!list.length && (
              <div className="mt-16 text-center text-zinc-500">
                <div className="mb-3 text-5xl">🐐</div>
                {tab === 'online' ? "Aucun ami en ligne pour l'instant." : tab === 'pending' ? "Aucune demande d'ami en attente." : tab === 'blocked' ? "Tu n'as bloqué personne." : "Tu n'as pas encore d'ami : ajoute-en un !"}
              </div>
            )}
            {list.map(({ id, sub, actions }) => (
              <div key={id} className="group flex items-center gap-3 border-t border-ink-700 px-2 py-3 transition hover:rounded-lg hover:bg-ink-750">
                <button onClick={(e) => openPopover(e.currentTarget, <UserMenu userId={id} />)}><Avatar user={users[id]} size={40} status /></button>
                <div className="min-w-0 flex-1"><div className="font-semibold">{users[id].username}</div><div className="truncate text-sm text-zinc-400">{sub}</div></div>
                <div className="flex gap-2">{actions}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
