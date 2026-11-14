import { useMemo } from 'react';
import { displayName, useStore } from '../../lib/store';
import { cx } from '../../lib/format';
import type { Server } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { openContextMenu, openPopover } from '../ui/Menu';
import { UserMenu } from '../UserMenu';

export function MemberList({ server }: { server: Server }) {
  const show = useStore((s) => s.showMembers);
  const users = useStore((s) => s.users);
  const groups = useMemo(() => {
    const hoisted = server.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
    const map = new Map<string, { title: string; color?: string; members: typeof server.members }>();
    for (const r of hoisted) map.set(`r${r.id}`, { title: r.name, color: r.color, members: [] });
    map.set('online', { title: 'En ligne', members: [] });
    map.set('offline', { title: 'Hors ligne', members: [] });
    for (const m of server.members) {
      const u = users[m.user.id] ?? m.user;
      if (u.status === 'offline') { map.get('offline')!.members.push(m); continue; }
      const role = hoisted.find((r) => m.roles.includes(r.id));
      map.get(role ? `r${role.id}` : 'online')!.members.push(m);
    }
    for (const g of map.values()) g.members.sort((a, b) => displayName(a.user.id, server.id).localeCompare(displayName(b.user.id, server.id)));
    return [...map.values()].filter((g) => g.members.length);
  }, [server, users]);
  if (!show) return null;
  return (
    <aside aria-label="Membres" className="hidden w-60 shrink-0 overflow-y-auto bg-ink-850 px-2 pb-4 lg:block">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="section-title pb-1 pt-5">{g.title} — {g.members.length}</h3>
          {g.members.map((m) => {
            const u = users[m.user.id] ?? m.user;
            const role = server.roles.filter((r) => !r.isDefault && m.roles.includes(r.id)).sort((a, b) => b.position - a.position)[0];
            return (
              <button key={u.id} onClick={(e) => openPopover(e.currentTarget, <UserMenu userId={u.id} serverId={server.id} />, 'left')}
                onContextMenu={(e) => openContextMenu(e, <UserMenu userId={u.id} serverId={server.id} />)}
                className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750', u.status === 'offline' && 'opacity-40')}>
                <Avatar user={u} size={32} status />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium" style={{ color: role?.color !== '#9aa4b8' ? role?.color : undefined }}>
                    {displayName(u.id, server.id)}{server.ownerId === u.id && ' 👑'}
                  </span>
                  {u.customStatus && <span className="block truncate text-xs text-zinc-500">{u.customStatus}</span>}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
