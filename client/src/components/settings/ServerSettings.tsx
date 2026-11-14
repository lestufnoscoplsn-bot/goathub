import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { emit, uploadFile } from '../../lib/socket';
import { closeModal, displayName, openModal, toast, useStore } from '../../lib/store';
import { canActOn, has, P, PERMISSION_INFO, permissionsIn, topPosition } from '../../lib/permissions';
import { cx } from '../../lib/format';
import type { Server } from '../../lib/types';
import { Avatar, ServerIcon } from '../ui/Avatar';
import { Field, Modal } from '../ui/Modal';
import { SettingsLayout } from './SettingsLayout';

const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast(ok, 'success')).catch((e) => toast(e.message, 'error'));

function Overview({ server }: { server: Server }) {
  const [name, setName] = useState(server.name);
  const me = useStore((s) => s.me!.id);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-5">
        <ServerIcon name={server.name} icon={server.icon} size={96} className="rounded-3xl" />
        <div className="space-y-2">
          <label className="btn-primary cursor-pointer">Changer l'icône
            <input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await run(uploadFile(f).then((up) => emit('server:update', { serverId: server.id, iconId: up.id })), 'Icône mise à jour.');
            }} />
          </label>
          {server.icon && <button className="btn-ghost ml-2" onClick={() => run(emit('server:update', { serverId: server.id, iconId: null }))}>Retirer</button>}
          <p className="text-xs text-zinc-500">Image carrée conseillée, au moins 256 × 256.</p>
        </div>
      </div>
      <Field label="Nom du serveur">
        <div className="flex gap-2"><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" disabled={name === server.name} onClick={() => run(emit('server:update', { serverId: server.id, name }), 'Enregistré.')}>Enregistrer</button></div>
      </Field>
      {server.ownerId === me && (
        <div className="rounded-xl border border-bad/40 p-4">
          <h3 className="font-bold text-bad">Zone dangereuse</h3>
          <p className="mb-3 text-sm text-zinc-400">Supprimer le serveur efface tous ses salons et messages. C'est définitif.</p>
          <button className="btn-danger" onClick={() => openModal({ kind: 'confirm', title: `Supprimer « ${server.name} » ?`, text: 'Tous les salons et messages seront effacés définitivement.', confirm: 'Supprimer le serveur', danger: true,
            onConfirm: () => emit('server:delete', { serverId: server.id }) })}>Supprimer le serveur</button>
        </div>
      )}
    </div>
  );
}

function Roles({ server }: { server: Server }) {
  const me = useStore((s) => s.me!.id);
  const myTop = topPosition(server, me);
  const myPerms = permissionsIn(server, me);
  const [selected, setSelected] = useState<number>(server.roles[0]?.id);
  const role = server.roles.find((r) => r.id === selected) ?? server.roles[0];
  const [draft, setDraft] = useState(role);
  useEffect(() => { setDraft(role); }, [role?.id, role?.permissions, role?.name, role?.color, role?.hoist]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = role && (role.isDefault || role.position < myTop);
  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <div className="w-full shrink-0 space-y-1 md:w-56">
        <button className="btn-primary mb-2 w-full" onClick={() => emit<{ id: number }>('role:create', { serverId: server.id }).then((r) => setSelected(r.id)).catch((e) => toast(e.message, 'error'))}>
          <Plus size={16} /> Créer un rôle
        </button>
        {server.roles.map((r) => (
          <div key={r.id} className={cx('group flex items-center rounded-md', selected === r.id ? 'bg-ink-600' : 'hover:bg-ink-700')}>
            <button onClick={() => setSelected(r.id)} className="flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />{r.name}
            </button>
            {!r.isDefault && r.position < myTop && (
              <span className="hidden pr-1 group-hover:flex">
                <button className="btn-icon h-6 w-6" aria-label="Monter" onClick={() => run(emit('role:move', { roleId: r.id, direction: 'up' }))}><ArrowUp size={13} /></button>
                <button className="btn-icon h-6 w-6" aria-label="Descendre" onClick={() => run(emit('role:move', { roleId: r.id, direction: 'down' }))}><ArrowDown size={13} /></button>
              </span>
            )}
          </div>
        ))}
        <p className="px-1 pt-2 text-xs text-zinc-500">Les rôles du haut sont les plus puissants. On ne peut gérer que les rôles placés sous le sien.</p>
      </div>
      {draft && (
        <div className="min-w-0 flex-1 space-y-4">
          {!editable && <p className="rounded-lg bg-warn/15 p-3 text-sm text-warn">Ce rôle est au-dessus du tien : tu ne peux pas le modifier.</p>}
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Nom du rôle"><input className="input" value={draft.name} disabled={draft.isDefault} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Couleur"><input type="color" className="h-[42px] w-16 cursor-pointer rounded-lg border border-ink-600 bg-ink-900" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></Field>
            </div>
            {!draft.isDefault && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={draft.hoist} onChange={(e) => setDraft({ ...draft, hoist: e.target.checked })} />
                Afficher les membres de ce rôle à part dans la liste</label>
            )}
            <div>
              <span className="label">Permissions</span>
              <div className="divide-y divide-ink-700 rounded-xl border border-ink-600">
                {PERMISSION_INFO.map(([bit, label, hint]) => {
                  const on = (draft.permissions & bit) !== 0;
                  const allowed = (myPerms & bit) !== 0;
                  return (
                    <label key={bit} className={cx('flex items-center gap-3 px-4 py-2.5', allowed ? 'cursor-pointer' : 'opacity-50')}>
                      <span className="flex-1"><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-zinc-500">{hint}</span>}</span>
                      <input type="checkbox" role="switch" className="peer sr-only" checked={on} disabled={!allowed}
                        onChange={(e) => setDraft({ ...draft, permissions: e.target.checked ? draft.permissions | bit : draft.permissions & ~bit })} />
                      <span className={cx('relative h-6 w-11 rounded-full transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform', on ? 'bg-brand-500 after:translate-x-5' : 'bg-ink-500')} />
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between">
              {!draft.isDefault ? <button className="btn-danger" onClick={() => openModal({ kind: 'confirm', title: `Supprimer le rôle « ${draft.name} » ?`, text: 'Les membres qui ont ce rôle le perdront.', confirm: 'Supprimer', danger: true,
                onConfirm: async () => { await emit('role:delete', { roleId: draft.id }); openModal({ kind: 'serverSettings', serverId: server.id, tab: 'roles' }); } })}><Trash2 size={16} /> Supprimer</button> : <span />}
              <button className="btn-primary" onClick={() => run(emit('role:update', { roleId: draft.id, name: draft.name, color: draft.color, permissions: draft.permissions, hoist: draft.hoist }), 'Rôle enregistré.')}>Enregistrer</button>
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

function Members({ server }: { server: Server }) {
  const me = useStore((s) => s.me!.id);
  const perms = permissionsIn(server, me);
  const myTop = topPosition(server, me);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const roles = server.roles.filter((r) => !r.isDefault);
  const setRoles = (userId: number, ids: number[]) => run(emit('member:roles', { serverId: server.id, userId, roleIds: ids }));
  return (
    <div className="space-y-3">
      <input className="input" placeholder="Rechercher un membre" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Rechercher un membre" />
      <div className="divide-y divide-ink-700 rounded-xl border border-ink-600">
        {server.members.filter((m) => displayName(m.user.id, server.id).toLowerCase().includes(filter.toLowerCase()) || m.user.username.toLowerCase().includes(filter.toLowerCase())).map((m) => {
          const canAct = canActOn(server, me, m.user.id);
          return (
            <div key={m.user.id} className="p-3">
              <div className="flex items-center gap-3">
                <Avatar user={m.user} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{displayName(m.user.id, server.id)}{server.ownerId === m.user.id && ' 👑'} <span className="text-xs text-zinc-500">{m.user.username}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {roles.filter((r) => m.roles.includes(r.id)).map((r) => <span key={r.id} className="chip"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}</span>)}
                    {m.mutedUntil && <span className="chip bg-warn/20 text-warn">Exclu</span>}
                    {m.voiceMuted && <span className="chip bg-bad/20 text-bad">Muet en vocal</span>}
                  </div>
                </div>
                {has(perms, P.MANAGE_ROLES) && (canAct || m.user.id === me) && <button className="btn-ghost py-1.5" onClick={() => setOpen(open === m.user.id ? null : m.user.id)}>Rôles</button>}
                {canAct && has(perms, P.MODERATE_MEMBERS) && <button className="btn-ghost py-1.5" onClick={() => openModal({ kind: 'moderate', serverId: server.id, userId: m.user.id, action: 'timeout' })}>Exclure</button>}
                {canAct && has(perms, P.KICK_MEMBERS) && <button className="btn-ghost py-1.5 text-bad" onClick={() => openModal({ kind: 'moderate', serverId: server.id, userId: m.user.id, action: 'kick' })}>Expulser</button>}
                {canAct && has(perms, P.BAN_MEMBERS) && <button className="btn-ghost py-1.5 text-bad" onClick={() => openModal({ kind: 'moderate', serverId: server.id, userId: m.user.id, action: 'ban' })}>Bannir</button>}
              </div>
              {open === m.user.id && (
                <div className="mt-3 flex flex-wrap gap-2 rounded-lg bg-ink-850 p-3">
                  {!roles.length && <span className="text-sm text-zinc-500">Crée d'abord un rôle dans l'onglet « Rôles ».</span>}
                  {roles.map((r) => {
                    const on = m.roles.includes(r.id);
                    return (
                      <button key={r.id} disabled={r.position >= myTop} onClick={() => setRoles(m.user.id, on ? m.roles.filter((x) => x !== r.id) : [...m.roles, r.id])}
                        className={cx('chip border py-1 transition disabled:opacity-40', on ? 'border-brand-500 bg-brand-500/20' : 'border-ink-500')}>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}{on && ' ✓'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useList<T>(event: string, data: unknown, deps: unknown[]) {
  const [list, setList] = useState<T[] | null>(null);
  const reload = () => emit<T[]>(event, data).then(setList).catch((e) => { toast(e.message, 'error'); setList([]); });
  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [list, reload] as const;
}

function Table({ empty, children }: { empty: string; children: ReactNode[] | null }) {
  if (children === null) return <p className="text-sm text-zinc-500">Chargement…</p>;
  if (!children.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  return <div className="divide-y divide-ink-700 rounded-xl border border-ink-600">{children}</div>;
}

function Invites({ server }: { server: Server }) {
  const publicUrl = useStore((s) => s.publicUrl);
  const [list, reload] = useList<any>('invite:list', { serverId: server.id }, [server.id]);
  return (
    <Table empty="Aucune invitation.">{list && list.map((i) => (
      <div key={i.code} className="flex items-center gap-3 p-3 text-sm">
        <code className="flex-1 truncate text-brand-300">{publicUrl}/invite/{i.code}</code>
        <span className="text-zinc-400">{i.uses}{i.maxUses ? `/${i.maxUses}` : ''} util.</span>
        <span className="text-zinc-400">{i.expiresAt ? `expire le ${new Date(i.expiresAt).toLocaleDateString('fr-FR')}` : "n'expire pas"}</span>
        <button className="btn-icon hover:text-bad" aria-label="Supprimer l'invitation" onClick={() => emit('invite:delete', { serverId: server.id, code: i.code }).then(reload).catch((e) => toast(e.message, 'error'))}><Trash2 size={15} /></button>
      </div>
    ))}</Table>
  );
}

function Bans({ server }: { server: Server }) {
  const [list, reload] = useList<any>('ban:list', { serverId: server.id }, [server.id]);
  return (
    <Table empty="Personne n'est banni de ce serveur.">{list && list.map((b) => (
      <div key={b.userId} className="flex items-center gap-3 p-3 text-sm">
        <span className="flex-1"><b>{b.username}</b>{b.reason && <span className="text-zinc-400"> — {b.reason}</span>}</span>
        <button className="btn-ghost py-1.5" onClick={() => emit('ban:remove', { serverId: server.id, userId: b.userId }).then(reload).catch((e) => toast(e.message, 'error'))}>Lever le bannissement</button>
      </div>
    ))}</Table>
  );
}

const REASON_LABEL: Record<string, string> = { spam: 'Spam', harcelement: 'Harcèlement', contenu_choquant: 'Contenu choquant', arnaque: 'Arnaque', usurpation: 'Usurpation', autre: 'Autre' };

export function Reports({ serverId }: { serverId?: number }) {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [list, reload] = useList<any>('report:list', { serverId, status }, [serverId, status]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">{(['open', 'resolved', 'dismissed'] as const).map((s) => (
        <button key={s} onClick={() => setStatus(s)} className={cx('rounded-md px-3 py-1 text-sm', status === s ? 'bg-ink-600 text-white' : 'text-zinc-400 hover:bg-ink-700')}>
          {s === 'open' ? 'À traiter' : s === 'resolved' ? 'Traités' : 'Rejetés'}
        </button>
      ))}</div>
      <Table empty="Aucun signalement.">{list && list.map((r) => (
        <div key={r.id} className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-bad/20 text-bad">{REASON_LABEL[r.reason] ?? r.reason}</span>
            <b>{r.targetName ?? 'Utilisateur supprimé'}</b><span className="text-zinc-500">signalé par {r.reporterName ?? '?'} · {new Date(r.createdAt).toLocaleString('fr-FR')}</span>
          </div>
          {r.messageCopy && <blockquote className="rounded-lg border-l-4 border-ink-500 bg-ink-850 p-2 text-zinc-300">{r.messageCopy}</blockquote>}
          {r.details && <p className="text-zinc-300">{r.details}</p>}
          {status === 'open' && (
            <div className="flex flex-wrap gap-2">
              {serverId && r.targetId && <button className="btn-ghost py-1.5" onClick={() => openModal({ kind: 'moderate', serverId, userId: r.targetId, action: 'timeout' })}>Exclure</button>}
              {serverId && r.targetId && <button className="btn-ghost py-1.5 text-bad" onClick={() => openModal({ kind: 'moderate', serverId, userId: r.targetId, action: 'ban' })}>Bannir</button>}
              <button className="btn-primary py-1.5" onClick={() => emit('report:resolve', { reportId: r.id, status: 'resolved' }).then(reload).catch((e) => toast(e.message, 'error'))}>Marquer comme traité</button>
              <button className="btn-ghost py-1.5" onClick={() => emit('report:resolve', { reportId: r.id, status: 'dismissed' }).then(reload).catch((e) => toast(e.message, 'error'))}>Rejeter</button>
            </div>
          )}
        </div>
      ))}</Table>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  member_join: 'a rejoint le serveur', member_kick: 'a expulsé', member_ban: 'a banni', member_unban: 'a levé le bannissement de', member_timeout: 'a exclu temporairement',
  member_timeout_end: "a levé l'exclusion de", voice_mute: 'a rendu muet en vocal', voice_unmute: 'a rendu la parole à', voice_disconnect: 'a déconnecté du vocal',
  auto_timeout: 'exclusion automatique (anti-spam) :', message_delete: 'a supprimé un message de', channel_create: 'a créé le salon', channel_update: 'a modifié le salon',
  channel_delete: 'a supprimé le salon', role_create: 'a créé un rôle', role_update: 'a modifié le rôle', role_delete: 'a supprimé le rôle', member_roles: 'a changé les rôles de',
  server_update: 'a modifié le serveur', server_transfer: 'a transféré le serveur à', report_resolved: 'a traité un signalement', report_dismissed: 'a rejeté un signalement',
};

function Audit({ server }: { server: Server }) {
  const [list] = useList<any>('audit:list', { serverId: server.id }, [server.id]);
  return (
    <Table empty="Rien dans le journal pour l'instant.">{list && list.map((a) => (
      <div key={a.id} className="flex flex-wrap items-baseline gap-x-2 p-3 text-sm">
        <b>{a.actor ?? '?'}</b><span className="text-zinc-400">{ACTIONS[a.action] ?? a.action}</span>
        <b>{a.targetName ?? (/^\d+$/.test(a.target) ? '' : a.target)}</b>
        {a.details && <span className="text-zinc-500">— {a.details}</span>}
        <span className="ml-auto text-xs text-zinc-500">{new Date(a.createdAt).toLocaleString('fr-FR')}</span>
      </div>
    ))}</Table>
  );
}

export function ServerSettings({ serverId, initialTab }: { serverId: number; initialTab?: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const me = useStore((s) => s.me!.id);
  if (!server) { closeModal(); return null; }
  const perms = permissionsIn(server, me);
  const tabs = [
    has(perms, P.MANAGE_SERVER) && { id: 'overview', label: "Vue d'ensemble", render: () => <Overview server={server} /> },
    has(perms, P.MANAGE_ROLES) && { id: 'roles', label: 'Rôles', render: () => <Roles server={server} /> },
    { id: 'members', label: 'Membres', render: () => <Members server={server} /> },
    has(perms, P.MANAGE_SERVER) && { id: 'invites', label: 'Invitations', render: () => <Invites server={server} /> },
    has(perms, P.BAN_MEMBERS) && { id: 'bans', label: 'Bannissements', render: () => <Bans server={server} /> },
    has(perms, P.MODERATE_MEMBERS) && { id: 'reports', label: 'Signalements', render: () => <Reports serverId={server.id} /> },
    (has(perms, P.MANAGE_SERVER) || has(perms, P.MODERATE_MEMBERS)) && { id: 'audit', label: 'Journal de modération', render: () => <Audit server={server} /> },
  ].filter(Boolean) as { id: string; label: string; render: () => ReactNode }[];
  return (
    <Modal onClose={closeModal} wide className="h-[min(760px,calc(100vh-2rem))] overflow-hidden p-0" label="Paramètres du serveur">
      <SettingsLayout title={server.name} tabs={tabs} initialTab={initialTab} />
    </Modal>
  );
}
