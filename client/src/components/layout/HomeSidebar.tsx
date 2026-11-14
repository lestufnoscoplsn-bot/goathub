import { Phone, Plus, Users, X } from 'lucide-react';
import { navigate, useRoute } from '../../lib/router';
import { emit } from '../../lib/socket';
import { dmName, openModal, set, useStore } from '../../lib/store';
import { cx, STATUS_LABEL } from '../../lib/format';
import { Avatar } from '../ui/Avatar';

export function HomeSidebar() {
  const route = useRoute();
  const { dms, reads, relations, voiceStates, me } = useStore();
  const incoming = Object.values(relations).filter((r) => r === 'incoming').length;
  const close = (id: number) => {
    set((s) => ({ dms: s.dms.filter((d) => d.id !== id) }));
    void emit('dm:close', { channelId: id }).catch(() => {});
    if (route.name === 'home' && route.dmId === id) navigate('/channels/@me');
  };
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-ink-950/60 px-3 shadow-sm">
        <button className="w-full rounded-md bg-ink-950 px-2 py-1.5 text-left text-sm text-zinc-500" onClick={() => openModal({ kind: 'newGroup' })}>
          Démarrer une conversation
        </button>
      </header>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <button onClick={() => navigate('/channels/@me')}
          className={cx('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[15px] font-medium transition-colors',
            route.name === 'home' && !route.dmId ? 'bg-ink-700 text-white' : 'text-zinc-400 hover:bg-ink-750 hover:text-zinc-200')}>
          <Users size={20} /> <span className="flex-1 text-left">Amis</span>
          {incoming > 0 && <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-white">{incoming}</span>}
        </button>
        <div className="flex items-center justify-between pb-1 pt-4">
          <span className="section-title">Messages privés</span>
          <button className="btn-icon h-6 w-6" title="Créer un groupe" aria-label="Créer un groupe" onClick={() => openModal({ kind: 'newGroup' })}><Plus size={16} /></button>
        </div>
        {!dms.length && <p className="px-2 text-sm text-zinc-500">Aucune conversation. Écris à un ami depuis l'onglet Amis.</p>}
        {dms.map((dm) => {
          const active = route.name === 'home' && route.dmId === dm.id;
          const others = dm.recipients.filter((r) => r.id !== me?.id);
          const inCall = (voiceStates[dm.id] ?? []).length > 0;
          return (
            <div key={dm.id} className={cx('group flex items-center rounded-md transition-colors', active ? 'bg-ink-700' : 'hover:bg-ink-750', reads[dm.id] && 'font-semibold')}>
              <button className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left" onClick={() => navigate(`/channels/@me/${dm.id}`)}>
                {dm.type === 'group'
                  ? <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white"><Users size={16} /></div>
                  : <Avatar user={others[0]} size={32} status />}
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[15px]', active || reads[dm.id] ? 'text-white' : 'text-zinc-300')}>{dmName(dm)}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {inCall ? <span className="flex items-center gap-1 text-ok"><Phone size={11} /> Appel en cours</span>
                      : dm.type === 'group' ? `${dm.recipients.length} membres` : others[0]?.customStatus || STATUS_LABEL[others[0]?.status ?? 'offline']}
                  </span>
                </span>
                {reads[dm.id] && <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-white">{reads[dm.id].unread}</span>}
              </button>
              <button className="btn-icon mr-1 h-6 w-6 opacity-0 group-hover:opacity-100" aria-label="Fermer la conversation" onClick={() => close(dm.id)}><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}
