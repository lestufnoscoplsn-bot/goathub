// Une conversation : salon textuel d'un serveur, message privé ou groupe.
import { AtSign, Hash, Phone, Pin, Users, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { emit, markRead } from '../../lib/socket';
import { displayName, dmName, openModal, set, toast, useStore } from '../../lib/store';
import { cx, day, sameDay } from '../../lib/format';
import { has, P, permissionsIn } from '../../lib/permissions';
import type { Message, User } from '../../lib/types';
import { local } from '../../lib/storage';
import { Avatar } from '../ui/Avatar';
import { openPopover } from '../ui/Menu';
import { startCall } from '../UserMenu';
import { CallPanel } from '../voice/CallPanel';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';

function TypingIndicator({ channelId, serverId }: { channelId: number; serverId?: number }) {
  const typing = useStore((s) => s.typing[channelId]);
  const me = useStore((s) => s.me!.id);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(t); }, []);
  const names = Object.entries(typing ?? {}).filter(([u, until]) => Number(u) !== me && until > Date.now()).map(([u]) => displayName(Number(u), serverId));
  return (
    <div className="h-6 truncate px-5 text-xs text-zinc-400" aria-live="polite">
      {names.length > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="flex gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
          <b className="text-zinc-200">{names.length > 2 ? 'Plusieurs personnes' : names.join(' et ')}</b> {names.length > 1 ? 'écrivent…' : 'écrit…'}
        </span>
      )}
    </div>
  );
}

function PinsPanel({ channelId, serverId }: { channelId: number; serverId?: number }) {
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => { emit<Message[]>('pins:get', { channelId }).then(setPins).catch((e) => toast(e.message, 'error')); }, [channelId]);
  return (
    <div className="max-h-[60vh] w-[420px] max-w-[90vw] overflow-y-auto rounded-xl border border-ink-600 bg-ink-900 p-3 shadow-pop">
      <h3 className="mb-2 font-bold">Messages épinglés</h3>
      {!pins ? <p className="text-sm text-zinc-500">Chargement…</p> : !pins.length ? <p className="text-sm text-zinc-500">Aucun message épinglé pour l'instant.</p> : pins.map((m) => (
        <button key={m.id} onClick={() => dispatchEvent(new CustomEvent('gh:jump', { detail: m.id }))} className="mb-2 block w-full rounded-lg bg-ink-800 p-2.5 text-left hover:bg-ink-750">
          <div className="text-sm font-semibold">{m.author ? displayName(m.author.id, serverId) : '?'} <span className="text-xs font-normal text-zinc-500">{new Date(m.createdAt).toLocaleString('fr-FR')}</span></div>
          <div className="line-clamp-3 text-sm text-zinc-300">{m.content || 'Pièce jointe'}</div>
        </button>
      ))}
    </div>
  );
}

export function ChatView({ channelId, serverId }: { channelId: number; serverId?: number }) {
  const me = useStore((s) => s.me!);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const dm = useStore((s) => s.dms.find((d) => d.id === channelId));
  const relations = useStore((s) => s.relations);
  const cache = useStore((s) => s.messages[channelId]);
  const showMembers = useStore((s) => s.showMembers);
  const call = useStore((s) => s.calls[channelId]);
  const inCall = useStore((s) => (s.voiceStates[channelId] ?? []).length > 0);
  const channel = server?.channels.find((c) => c.id === channelId);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const perms = server ? permissionsIn(server, me.id) : null;
  const member = server?.members.find((m) => m.user.id === me.id);

  const load = useCallback(async (before?: number) => {
    set((s) => ({ messages: { ...s.messages, [channelId]: { list: s.messages[channelId]?.list ?? [], hasMore: s.messages[channelId]?.hasMore ?? true, loaded: !!s.messages[channelId]?.loaded, loading: true } } }));
    try {
      const res = await emit<{ messages: Message[]; hasMore: boolean }>('messages:get', { channelId, before });
      set((s) => {
        const prev = s.messages[channelId]?.list ?? [];
        const list = before ? [...res.messages, ...prev] : [...res.messages, ...prev.filter((m) => m.pending)];
        return { messages: { ...s.messages, [channelId]: { list, hasMore: res.hasMore, loaded: true, loading: false } } };
      });
    } catch (err) {
      toast((err as Error).message, 'error');
      set((s) => ({ messages: { ...s.messages, [channelId]: { ...s.messages[channelId], loading: false } } }));
    }
  }, [channelId]);

  useEffect(() => {
    stick.current = true;
    if (!useStore.getState().messages[channelId]?.loaded) void load();
  }, [channelId, load]);

  const list = cache?.list ?? [];
  const lastId = list.filter((m) => m.id > 0).at(-1)?.id;

  // Marque comme lu quand on regarde le bas de la conversation
  useEffect(() => {
    if (lastId && stick.current && document.hasFocus()) markRead(channelId, lastId);
    else if (cache?.loaded && !lastId) markRead(channelId);
  }, [lastId, channelId, cache?.loaded]);
  useEffect(() => {
    const focus = () => lastId && stick.current && markRead(channelId, lastId);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [lastId, channelId]);

  // Garde la position en bas quand de nouveaux messages arrivent
  const prevHeight = useRef(0);
  const prevFirst = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (prevFirst.current !== undefined && list[0]?.id !== prevFirst.current && !stick.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current; // anciens messages ajoutés en haut
    } else if (stick.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = el.scrollHeight;
    prevFirst.current = list[0]?.id;
  }, [list]);
  useEffect(() => {
    const sent = () => { stick.current = true; requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }); };
    const edit = (e: Event) => setEditing((e as CustomEvent<number>).detail);
    const jump = async (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      let el = box.current?.querySelector(`[data-id="${id}"]`);
      if (!el) {
        const res = await emit<{ messages: Message[] }>('messages:get', { channelId, around: id }).catch(() => null);
        if (!res) return;
        stick.current = false;
        set((s) => ({ messages: { ...s.messages, [channelId]: { list: res.messages, hasMore: true, loaded: true, loading: false } } }));
        await new Promise((r) => setTimeout(r, 50));
        el = box.current?.querySelector(`[data-id="${id}"]`);
      }
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(id);
      setTimeout(() => setHighlight(null), 1800);
    };
    addEventListener('gh:sent', sent);
    addEventListener('gh:edit-last', edit);
    addEventListener('gh:jump', jump);
    return () => { removeEventListener('gh:sent', sent); removeEventListener('gh:edit-last', edit); removeEventListener('gh:jump', jump); };
  }, [channelId]);

  const onScroll = () => {
    const el = box.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 300 && cache?.hasMore && !cache.loading && list.length) void load(list.find((m) => m.id > 0)?.id);
    if (stick.current && lastId && useStore.getState().reads[channelId]) markRead(channelId, lastId);
  };

  const people = useMemo<User[]>(() => {
    const users = useStore.getState().users;
    if (server) return server.members.map((m) => users[m.user.id] ?? m.user);
    return dm ? [...dm.recipients.map((r) => users[r.id] ?? r), me] : [];
  }, [server, dm, me]);

  let title = '';
  let placeholder = '';
  let disabledReason: string | null = null;
  const other = dm?.type === 'dm' ? dm.recipients.find((r) => r.id !== me.id) ?? dm.recipients[0] : undefined;
  if (channel) {
    title = channel.name;
    placeholder = `Envoyer un message dans #${channel.name}`;
    if (member?.mutedUntil && new Date(member.mutedUntil) > new Date()) disabledReason = `Tu es exclu temporairement de ce serveur jusqu'à ${new Date(member.mutedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
    else if (perms !== null && !has(perms, P.SEND_MESSAGES)) disabledReason = "Tu n'as pas la permission d'écrire dans ce salon.";
  } else if (dm) {
    title = dmName(dm);
    placeholder = `Envoyer un message à ${dm.type === 'dm' ? '@' : ''}${title}`;
    if (other && relations[other.id] === 'blocked') disabledReason = 'Tu as bloqué cette personne. Débloque-la pour lui écrire.';
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) dispatchEvent(new CustomEvent('gh:drop-files', { detail: [...e.dataTransfer.files] }));
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-950/60 pl-12 pr-3 shadow-sm md:pl-4">
        {channel ? <Hash size={22} className="text-zinc-500" /> : dm?.type === 'group' ? <Users size={20} className="text-zinc-500" /> : <AtSign size={20} className="text-zinc-500" />}
        {other && <Avatar user={useStore.getState().users[other.id] ?? other} size={24} status />}
        <h1 className="truncate font-bold">{title}</h1>
        {channel?.topic && <span className="hidden truncate border-l border-ink-600 pl-3 text-sm text-zinc-400 sm:block" title={channel.topic}>{channel.topic}</span>}
        {channel?.slowmode ? <span className="chip text-zinc-400" title="Mode lent">⏱ {channel.slowmode}s</span> : null}
        <div className="flex-1" />
        {dm && !inCall && <button className="btn-icon" title="Démarrer un appel" aria-label="Démarrer un appel" onClick={() => startCall(channelId)}><Phone size={19} /></button>}
        {dm?.type === 'group' && <button className="btn-icon" title="Ajouter des amis" aria-label="Ajouter des amis au groupe" onClick={() => openModal({ kind: 'newGroup', channelId })}><UserPlus size={19} /></button>}
        <button className="btn-icon" title="Messages épinglés" aria-label="Messages épinglés" onClick={(e) => openPopover(e.currentTarget, <PinsPanel channelId={channelId} serverId={serverId} />, 'bottom')}><Pin size={19} /></button>
        {server && (
          <button className={cx('btn-icon hidden lg:inline-grid', showMembers && 'text-zinc-100')} title="Liste des membres" aria-label="Afficher ou masquer les membres"
            onClick={() => { set({ showMembers: !showMembers }); local.set('showMembers', !showMembers); }}><Users size={19} /></button>
        )}
      </header>

      {dm && (call || inCall) && <CallPanel channelId={channelId} />}

      <div ref={box} onScroll={onScroll} className="flex-1 overflow-y-auto overflow-x-hidden pb-3" role="log" aria-label="Messages">
        {cache?.loaded && !cache.hasMore && (
          <div className="px-4 pb-2 pt-10">
            {channel ? (
              <>
                <div className="grid h-16 w-16 place-items-center rounded-full bg-ink-700"><Hash size={36} /></div>
                <h2 className="mt-3 text-3xl font-extrabold">Bienvenue dans #{channel.name} !</h2>
                <p className="text-zinc-400">C'est le début du salon #{channel.name}.</p>
              </>
            ) : dm && (
              <>
                {other ? <Avatar user={other} size={80} /> : <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500"><Users size={36} /></div>}
                <h2 className="mt-3 text-3xl font-extrabold">{title}</h2>
                <p className="text-zinc-400">C'est le début de ta conversation {dm.type === 'group' ? 'de groupe' : `avec ${title}`}.</p>
              </>
            )}
          </div>
        )}
        {cache?.loading && <div className="py-4 text-center text-sm text-zinc-500">Chargement…</div>}
        {list.map((msg, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, msg.createdAt);
          const grouped = !!prev && !newDay && !msg.replyTo && prev.kind === 'default' && msg.kind === 'default' && prev.author?.id === msg.author?.id
            && +new Date(msg.createdAt) - +new Date(prev.createdAt) < 7 * 60_000;
          return (
            <div key={msg.nonce ?? msg.id}>
              {newDay && <div className="mx-4 my-4 flex items-center gap-3 text-xs font-semibold text-zinc-500"><span className="h-px flex-1 bg-ink-600" />{day(msg.createdAt)}<span className="h-px flex-1 bg-ink-600" /></div>}
              <MessageItem msg={msg} grouped={grouped} perms={perms} onReply={setReplyTo} editing={editing === msg.id} setEditing={setEditing} highlight={highlight === msg.id} />
            </div>
          );
        })}
      </div>

      <Composer key={channelId} channelId={channelId} serverId={serverId} placeholder={placeholder} disabledReason={disabledReason}
        canAttach={perms === null || has(perms, P.ATTACH_FILES)} replyTo={replyTo} setReplyTo={setReplyTo} people={people} />
      <TypingIndicator channelId={channelId} serverId={serverId} />

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 grid animate-fade-in place-items-center rounded-2xl border-2 border-dashed border-brand-500 bg-ink-950/85">
          <div className="text-center"><div className="text-xl font-bold">Dépose tes fichiers</div><div className="text-zinc-400">Ils seront joints à ton message.</div></div>
        </div>
      )}
    </div>
  );
}
