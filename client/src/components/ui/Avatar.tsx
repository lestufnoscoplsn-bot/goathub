import { colorFor, cx, STATUS_COLOR } from '../../lib/format';
import type { User } from '../../lib/types';

export function Avatar({ user, size = 40, status, speaking, className }: {
  user: Pick<User, 'id' | 'username' | 'avatar'> & { status?: User['status'] } | null | undefined;
  size?: number; status?: boolean; speaking?: boolean; className?: string;
}) {
  const dot = Math.max(10, Math.round(size * 0.32));
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div className={cx('grid h-full w-full place-items-center overflow-hidden rounded-full font-semibold text-white transition-shadow', speaking && 'speaking')}
        style={{ background: user?.avatar ? undefined : colorFor(user?.id ?? 0), fontSize: size * 0.42 }}>
        {user?.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : (user?.username?.[0] ?? '?').toUpperCase()}
      </div>
      {status && (
        <span className={cx('absolute -bottom-0.5 -right-0.5 rounded-full border-[3px] border-ink-850', STATUS_COLOR[user?.status ?? 'offline'])}
          style={{ width: dot + 4, height: dot + 4 }} title={user?.status} />
      )}
    </div>
  );
}

export function ServerIcon({ name, icon, size = 48, className }: { name: string; icon: string | null; size?: number; className?: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return (
    <div className={cx('grid shrink-0 place-items-center overflow-hidden bg-ink-700 font-semibold text-zinc-100', className)} style={{ width: size, height: size, fontSize: size * 0.32 }}>
      {icon ? <img src={icon} alt="" className="h-full w-full object-cover" draggable={false} /> : initials}
    </div>
  );
}
