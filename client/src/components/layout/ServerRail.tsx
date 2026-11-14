import { Compass, MessageCircle, Plus } from 'lucide-react';
import { navigate, useRoute } from '../../lib/router';
import { openModal, useStore } from '../../lib/store';
import { cx } from '../../lib/format';
import { Avatar, ServerIcon } from '../ui/Avatar';

function RailItem({ active, unread, badge, label, onClick, children, className }: {
  active?: boolean; unread?: boolean; badge?: number; label: string; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <div className="group relative flex w-[72px] justify-center">
      <span className={cx('absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all duration-200',
        active ? 'h-10' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5')} />
      <button onClick={onClick} aria-label={label} title={label}
        className={cx('relative grid h-12 w-12 place-items-center overflow-hidden transition-all duration-200',
          active ? 'rounded-2xl' : 'rounded-[24px] hover:rounded-2xl', className)}>
        {children}
      </button>
      {!!badge && (
        <span className="pointer-events-none absolute -bottom-0.5 right-2.5 min-w-[20px] rounded-full border-[3px] border-ink-950 bg-bad px-1 text-center text-[11px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  );
}

export function ServerRail() {
  const route = useRoute();
  const { serverOrder, servers, reads, dms, relations } = useStore();
  const incoming = Object.values(relations).filter((r) => r === 'incoming').length;
  const unreadDms = dms.filter((d) => reads[d.id]);
  return (
    <nav aria-label="Serveurs" className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-ink-950 py-3 [scrollbar-width:none]">
      <RailItem active={route.name === 'home' || route.name === 'invite'} label="Messages privés" badge={incoming} onClick={() => navigate('/channels/@me')}
        className={cx(route.name === 'home' ? 'bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white' : 'bg-ink-750 text-zinc-300 hover:bg-gradient-to-br hover:from-brand-500 hover:to-fuchsia-500 hover:text-white')}>
        <MessageCircle size={24} />
      </RailItem>
      {unreadDms.map((dm) => (
        <RailItem key={dm.id} unread label="Message privé" badge={reads[dm.id].unread} onClick={() => navigate(`/channels/@me/${dm.id}`)}>
          <Avatar user={dm.recipients[0]} size={48} />
        </RailItem>
      ))}
      <div className="mx-auto h-0.5 w-8 shrink-0 rounded bg-ink-700" />
      {serverOrder.map((id) => {
        const server = servers[id];
        if (!server) return null;
        const unread = server.channels.some((c) => reads[c.id]);
        const mentions = server.channels.reduce((n, c) => n + (reads[c.id]?.mentions ?? 0), 0);
        const active = route.name === 'server' && route.serverId === id;
        return (
          <RailItem key={id} active={active} unread={unread} badge={mentions} label={server.name} onClick={() => navigate(`/channels/${id}`)}>
            <ServerIcon name={server.name} icon={server.icon} size={48} className={cx(active ? '' : 'hover:bg-brand-500')} />
          </RailItem>
        );
      })}
      <RailItem label="Créer ou rejoindre un serveur" onClick={() => openModal({ kind: 'createServer' })} className="bg-ink-750 text-ok hover:bg-ok hover:text-white">
        <Plus size={24} />
      </RailItem>
      <RailItem label="Rejoindre avec un lien" onClick={() => openModal({ kind: 'createServer' })} className="bg-ink-750 text-zinc-300 hover:bg-brand-500 hover:text-white">
        <Compass size={22} />
      </RailItem>
    </nav>
  );
}
