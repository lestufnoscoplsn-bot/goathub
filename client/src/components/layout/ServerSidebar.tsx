import { ChevronDown, Hash, LogOut, MicOff, Monitor, Plus, Settings, UserPlus, Video, Volume2, FolderPlus, Pencil, HeadphoneOff, Flag } from 'lucide-react';
import { useState } from 'react';
import { navigate, useRoute } from '../../lib/router';
import { emit } from '../../lib/socket';
import { displayName, get, openModal, toast, useStore, NO_VOICE, NO_SPEAKING } from '../../lib/store';
import { cx } from '../../lib/format';
import { has, P, permissionsIn } from '../../lib/permissions';
import type { Channel, Server } from '../../lib/types';
import { local } from '../../lib/storage';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { Menu, openContextMenu, openPopover } from '../ui/Menu';
import { UserMenu } from '../UserMenu';

function VoiceMembers({ server, channel }: { server: Server; channel: Channel }) {
  const users = useStore((s) => s.voiceStates[channel.id] ?? NO_VOICE);
  const speaking = useStore((s) => (s.voice.channelId === channel.id ? s.voice.speaking : NO_SPEAKING));
  const all = useStore((s) => s.users);
  if (!users.length) return null;
  return (
    <div className="mb-1 ml-7 space-y-0.5">
      {users.map((u) => (
        <button key={u.userId} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-zinc-400 hover:bg-ink-750 hover:text-zinc-200"
          onClick={(e) => openPopover(e.currentTarget, <UserMenu userId={u.userId} serverId={server.id} />)}
          onContextMenu={(e) => openContextMenu(e, <UserMenu userId={u.userId} serverId={server.id} />)}>
          <Avatar user={all[u.userId]} size={22} speaking={speaking[u.userId] && !u.muted} />
          <span className={cx('flex-1 truncate', speaking[u.userId] && !u.muted && 'text-white')}>{displayName(u.userId, server.id)}</span>
          {u.screen && <span className="rounded bg-bad px-1 text-[10px] font-bold text-white">LIVE</span>}
          {u.video && <Video size={13} />}
          {u.serverMuted ? <MicOff size={13} className="text-bad" /> : u.muted && <MicOff size={13} />}
          {u.deafened && <HeadphoneOff size={13} />}
        </button>
      ))}
    </div>
  );
}

function ChannelRow({ server, channel, canManage }: { server: Server; channel: Channel; canManage: boolean }) {
  const route = useRoute();
  const read = useStore((s) => s.reads[channel.id]);
  const inVoice = useStore((s) => s.voice.channelId === channel.id);
  const count = useStore((s) => (s.voiceStates[channel.id] ?? []).length);
  const active = route.name === 'server' && route.channelId === channel.id;
  const open = () => {
    if (channel.type === 'voice') {
      navigate(`/channels/${server.id}/${channel.id}`);
      if (!inVoice) void voice.join(channel.id);
    } else navigate(`/channels/${server.id}/${channel.id}`);
  };
  const menu = (e: React.MouseEvent) => canManage && openContextMenu(e, <Menu items={[
    { label: 'Modifier le salon', icon: <Settings size={15} />, onClick: () => openModal({ kind: 'channelSettings', channelId: channel.id, serverId: server.id }) },
    { label: 'Monter', onClick: () => emit('channel:move', { channelId: channel.id, direction: 'up' }).catch((err) => toast(err.message, 'error')) },
    { label: 'Descendre', onClick: () => emit('channel:move', { channelId: channel.id, direction: 'down' }).catch((err) => toast(err.message, 'error')) },
  ]} />);
  return (
    <>
      <div onContextMenu={menu} className={cx('group relative flex items-center rounded-md transition-colors',
        active || inVoice ? 'bg-ink-700 text-white' : read ? 'text-white hover:bg-ink-750' : 'text-zinc-400 hover:bg-ink-750 hover:text-zinc-200')}>
        {read && !active && <span className="absolute -left-2 h-2 w-1 rounded-r-full bg-white" />}
        <button onClick={open} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
          {channel.type === 'voice' ? <Volume2 size={18} className="shrink-0 opacity-70" /> : <Hash size={18} className="shrink-0 opacity-70" />}
          <span className={cx('flex-1 truncate text-[15px]', read && 'font-semibold')}>{channel.name}</span>
          {channel.type === 'voice' && channel.userLimit > 0 && <span className="rounded bg-ink-950 px-1 text-[11px] text-zinc-400">{count}/{channel.userLimit}</span>}
          {!!read?.mentions && <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-white">{read.mentions}</span>}
        </button>
        {canManage && (
          <button className="btn-icon mr-1 h-6 w-6 opacity-0 group-hover:opacity-100" aria-label="Modifier le salon" title="Modifier le salon"
            onClick={() => openModal({ kind: 'channelSettings', channelId: channel.id, serverId: server.id })}><Settings size={14} /></button>
        )}
      </div>
      {channel.type === 'voice' && <VoiceMembers server={server} channel={channel} />}
    </>
  );
}

export function ServerSidebar({ server }: { server: Server }) {
  const me = useStore((s) => s.me!);
  const perms = permissionsIn(server, me.id);
  const canManage = has(perms, P.MANAGE_CHANNELS);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => local.get('collapsed', {}));
  const toggle = (id: number) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    local.set('collapsed', next);
  };
  const reads = useStore((s) => s.reads);
  const route = useRoute();

  const openMenu = (el: Element) => openPopover(el, <Menu items={[
    has(perms, P.CREATE_INVITE) && { label: 'Inviter des amis', icon: <UserPlus size={15} />, onClick: () => openModal({ kind: 'invite', serverId: server.id }) },
    (has(perms, P.MANAGE_SERVER) || has(perms, P.MANAGE_ROLES) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.MODERATE_MEMBERS)) &&
      { label: 'Paramètres du serveur', icon: <Settings size={15} />, onClick: () => openModal({ kind: 'serverSettings', serverId: server.id }) },
    has(perms, P.MODERATE_MEMBERS) && { label: 'Signalements', icon: <Flag size={15} />, onClick: () => openModal({ kind: 'serverSettings', serverId: server.id, tab: 'reports' }) },
    canManage && { label: 'Créer un salon', icon: <Plus size={15} />, onClick: () => openModal({ kind: 'createChannel', serverId: server.id }) },
    canManage && { label: 'Créer une catégorie', icon: <FolderPlus size={15} />, onClick: () => openModal({
      kind: 'prompt', title: 'Créer une catégorie', label: 'Nom de la catégorie', maxLength: 40, confirm: 'Créer',
      onSubmit: (name) => emit('category:create', { serverId: server.id, name }),
    }) },
    { label: 'Changer mon pseudo', icon: <Pencil size={15} />, onClick: () => openModal({
      kind: 'prompt', title: 'Pseudo sur ce serveur', label: 'Pseudo (vide = pseudo habituel)', maxLength: 32, confirm: 'Enregistrer', allowEmpty: true,
      value: server.members.find((m) => m.user.id === me.id)?.nickname ?? '',
      onSubmit: (nickname) => emit('member:nick', { serverId: server.id, nickname }),
    }) },
    server.ownerId !== me.id && 'sep',
    server.ownerId !== me.id && { label: 'Quitter le serveur', icon: <LogOut size={15} />, danger: true, onClick: () => openModal({
      kind: 'confirm', title: `Quitter « ${server.name} » ?`, text: "Tu pourras revenir avec un lien d'invitation.", confirm: 'Quitter', danger: true,
      onConfirm: async () => { await emit('server:leave', { serverId: server.id }); },
    }) },
  ]} />, 'bottom');

  const known = new Set(server.categories.map((c) => c.id));
  const loose = server.channels.filter((c) => !c.categoryId || !known.has(c.categoryId));
  return (
    <>
      <header>
        <button onClick={(e) => openMenu(e.currentTarget)} className="flex h-12 w-full items-center justify-between border-b border-ink-950/60 px-4 font-bold shadow-sm transition-colors hover:bg-ink-750">
          <span className="truncate">{server.name}</span><ChevronDown size={18} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-3">
        {loose.map((c) => <ChannelRow key={c.id} server={server} channel={c} canManage={canManage} />)}
        {server.categories.map((cat) => {
          const channels = server.channels.filter((c) => c.categoryId === cat.id);
          const isCollapsed = collapsed[cat.id];
          const visible = isCollapsed ? channels.filter((c) => reads[c.id] || (route.name === 'server' && route.channelId === c.id) || get().voice.channelId === c.id) : channels;
          return (
            <div key={cat.id} className="mt-4 first:mt-0">
              <div className="group flex items-center pr-1">
                <button onClick={() => toggle(cat.id)} className="flex flex-1 items-center gap-0.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
                  <ChevronDown size={12} className={cx('transition-transform', isCollapsed && '-rotate-90')} />{cat.name}
                </button>
                {canManage && (
                  <>
                    <button className="btn-icon h-5 w-5 opacity-0 group-hover:opacity-100" aria-label="Modifier la catégorie" title="Modifier la catégorie" onClick={() => openModal({
                      kind: 'prompt', title: 'Modifier la catégorie', label: 'Nom (vide pour supprimer la catégorie ; ses salons sont gardés)', value: cat.name, maxLength: 40,
                      confirm: 'Enregistrer', allowEmpty: true,
                      onSubmit: (name) => (name ? emit('category:update', { categoryId: cat.id, name }) : emit('category:delete', { categoryId: cat.id })),
                    })}><Pencil size={12} /></button>
                    <button className="btn-icon h-5 w-5" aria-label="Créer un salon" title="Créer un salon"
                      onClick={() => openModal({ kind: 'createChannel', serverId: server.id, categoryId: cat.id, type: channels.every((c) => c.type === 'voice') && channels.length ? 'voice' : 'text' })}><Plus size={15} /></button>
                  </>
                )}
              </div>
              <div className="space-y-0.5">
                {visible.map((c) => <ChannelRow key={c.id} server={server} channel={c} canManage={canManage} />)}
              </div>
            </div>
          );
        })}
      </div>
      <ScreenShareHint />
    </>
  );
}

function ScreenShareHint() {
  const screen = useStore((s) => s.voice.screen);
  if (!screen) return null;
  return <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-brand-500/15 px-3 py-2 text-xs text-brand-300"><Monitor size={14} /> Tu partages ton écran</div>;
}
