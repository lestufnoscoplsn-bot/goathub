import { CornerUpLeft, Download, FileText, Flag, Pencil, Phone, Pin, SmilePlus, Trash2 } from 'lucide-react';
import { memo, useState, type KeyboardEvent } from 'react';
import { emit } from '../../lib/socket';
import { displayName, openModal, roleColor, toast, useStore } from '../../lib/store';
import { cx, full, hour, size } from '../../lib/format';
import { Markdown } from '../../lib/markdown';
import { has, P } from '../../lib/permissions';
import type { Attachment, Message } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { EmojiPicker } from '../ui/EmojiPicker';
import { closePopover, openContextMenu, openPopover, Menu } from '../ui/Menu';
import { UserMenu } from '../UserMenu';

function AttachmentView({ file }: { file: Attachment }) {
  if (file.kind === 'image') {
    return (
      <button onClick={() => openModal({ kind: 'image', url: file.url, name: file.name })} className="block overflow-hidden rounded-lg">
        <img src={file.url} alt={file.name} loading="lazy" className="max-h-80 max-w-[min(420px,100%)] rounded-lg object-contain transition hover:brightness-110" />
      </button>
    );
  }
  if (file.kind === 'video') return <video src={file.url} controls preload="metadata" className="max-h-80 max-w-[min(480px,100%)] rounded-lg bg-black" />;
  if (file.kind === 'audio') return <div className="w-[min(420px,100%)] rounded-lg border border-ink-600 bg-ink-850 p-3"><div className="mb-1 truncate text-sm">{file.name}</div><audio src={file.url} controls preload="none" className="w-full" /></div>;
  return (
    <a href={file.url} download={file.name} className="flex w-[min(420px,100%)] items-center gap-3 rounded-lg border border-ink-600 bg-ink-850 p-3 hover:border-ink-500">
      <FileText size={30} className="shrink-0 text-brand-400" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-sky-400">{file.name}</span><span className="text-xs text-zinc-500">{size(file.size)}</span></span>
      <Download size={18} className="text-zinc-400" />
    </a>
  );
}

export const MessageItem = memo(function MessageItem({ msg, grouped, perms, onReply, editing, setEditing, highlight }: {
  msg: Message; grouped: boolean; perms: number | null; onReply: (m: Message) => void;
  editing: boolean; setEditing: (id: number | null) => void; highlight?: boolean;
}) {
  const me = useStore((s) => s.me!);
  useStore((s) => s.users); // noms à jour
  const [draft, setDraft] = useState(msg.content);
  const mine = msg.author?.id === me.id;
  const canModerate = perms !== null && has(perms, P.MANAGE_MESSAGES);
  const canPin = perms === null || canModerate;
  const canReact = perms === null || has(perms, P.ADD_REACTIONS);
  const mentioned = msg.mentions.includes(me.id) || msg.mentionEveryone;
  const ctx = {
    nameOf: (id: number) => displayName(id, msg.serverId), myId: me.id,
    onMention: (id: number, el: HTMLElement) => openPopover(el, <UserMenu userId={id} serverId={msg.serverId ?? undefined} />),
  };
  const run = (p: Promise<unknown>) => p.catch((e) => toast(e.message, 'error'));
  const react = (emoji: string) => run(emit('reaction:toggle', { messageId: msg.id, emoji }));
  const pickReaction = (el: Element) => openPopover(el, <EmojiPicker onPick={(e) => { closePopover(); react(e); }} />, 'left');
  const remove = () => openModal({ kind: 'confirm', title: 'Supprimer ce message ?', text: msg.content.slice(0, 200) || 'Pièce jointe', confirm: 'Supprimer', danger: true,
    onConfirm: () => emit('message:delete', { messageId: msg.id }) });
  const saveEdit = async () => {
    if (draft.trim() === msg.content) return setEditing(null);
    try { await emit('message:edit', { messageId: msg.id, content: draft }); setEditing(null); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const editKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
  };
  const author = msg.author ? useStore.getState().users[msg.author.id] ?? msg.author : null;
  const openAuthor = (el: Element) => msg.author && openPopover(el, <UserMenu userId={msg.author.id} serverId={msg.serverId ?? undefined} />);
  const contextMenu = (e: React.MouseEvent) => openContextMenu(e, <Menu items={[
    canReact && { label: 'Ajouter une réaction', icon: <SmilePlus size={15} />, onClick: () => pickReaction(e.currentTarget as Element) },
    { label: 'Répondre', icon: <CornerUpLeft size={15} />, onClick: () => onReply(msg) },
    mine && msg.kind === 'default' && { label: 'Modifier', icon: <Pencil size={15} />, onClick: () => { setDraft(msg.content); setEditing(msg.id); } },
    canPin && { label: msg.pinned ? 'Désépingler' : 'Épingler', icon: <Pin size={15} />, onClick: () => run(emit('message:pin', { messageId: msg.id, pinned: !msg.pinned })) },
    { label: 'Copier le texte', onClick: () => navigator.clipboard.writeText(msg.content).catch(() => {}) },
    !mine && msg.author && { label: 'Signaler le message', icon: <Flag size={15} />, danger: true, onClick: () => openModal({ kind: 'report', userId: msg.author!.id, messageId: msg.id }) },
    (mine || canModerate) && { label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, onClick: remove },
  ]} />);

  if (msg.kind === 'call') {
    return (
      <div className="flex items-center gap-3 px-4 py-1.5 text-sm text-zinc-400" data-id={msg.id}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ok/20 text-ok"><Phone size={14} /></span>
        <span><b className="text-zinc-200">{msg.author ? displayName(msg.author.id) : ''}</b> a lancé un appel · {msg.content}</span>
        <span className="text-xs">{full(msg.createdAt)}</span>
      </div>
    );
  }

  return (
    <div data-id={msg.id} onContextMenu={contextMenu}
      className={cx('group relative px-4 py-0.5 transition-colors hover:bg-ink-850/60', !grouped && 'mt-3.5',
        mentioned && 'border-l-2 border-warn bg-warn/[.06] hover:bg-warn/10', highlight && 'animate-pulse bg-brand-500/15', msg.pending && 'opacity-60')}>
      {msg.replyTo && (
        <div className="mb-0.5 ml-[52px] flex items-center gap-1.5 text-sm text-zinc-400">
          <span className="-ml-7 mt-2 h-3 w-6 rounded-tl-md border-l-2 border-t-2 border-ink-500" />
          <Avatar user={msg.replyTo.author} size={16} />
          <b className="shrink-0 text-zinc-300">{msg.replyTo.author ? displayName(msg.replyTo.author.id, msg.serverId) : 'Message supprimé'}</b>
          <button className="truncate hover:text-zinc-200" onClick={() => dispatchEvent(new CustomEvent('gh:jump', { detail: msg.replyTo!.id }))}>
            {msg.replyTo.content.replace(/<@(\d+)>/g, (_, id) => '@' + displayName(Number(id), msg.serverId)) || (msg.replyTo.hasAttachment ? 'Pièce jointe' : '')}
          </button>
        </div>
      )}
      <div className="flex gap-4">
        <div className="w-10 shrink-0">
          {grouped
            ? <time className="invisible block pt-1 text-right text-[10px] text-zinc-500 group-hover:visible">{hour(msg.createdAt)}</time>
            : <button onClick={(e) => openAuthor(e.currentTarget)} className="mt-0.5 transition active:translate-y-px" aria-label="Profil"><Avatar user={author} size={40} /></button>}
        </div>
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <button onClick={(e) => openAuthor(e.currentTarget)} className="font-semibold hover:underline" style={{ color: msg.author ? roleColor(msg.author.id, msg.serverId) : undefined }}>
                {msg.author ? displayName(msg.author.id, msg.serverId) : 'Utilisateur supprimé'}
              </button>
              <time className="text-xs text-zinc-500" title={new Date(msg.createdAt).toLocaleString('fr-FR')}>{full(msg.createdAt)}</time>
              {msg.pinned && <Pin size={12} className="text-brand-400" />}
            </div>
          )}
          {editing ? (
            <div className="my-1">
              <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={editKeys} maxLength={2000} rows={Math.min(8, draft.split('\n').length)}
                className="input resize-none bg-ink-750" aria-label="Modifier le message" />
              <div className="mt-1 text-xs text-zinc-500">Échap pour <button className="text-sky-400" onClick={() => setEditing(null)}>annuler</button> · Entrée pour <button className="text-sky-400" onClick={saveEdit}>enregistrer</button></div>
            </div>
          ) : msg.content && (
            <div className="text-[15px] text-zinc-100">
              <Markdown text={msg.content} ctx={ctx} />
              {msg.editedAt && <span className="ml-1 text-[10px] text-zinc-500" title={full(msg.editedAt)}>(modifié)</span>}
            </div>
          )}
          {msg.attachments.length > 0 && <div className="mt-1 flex flex-col items-start gap-2">{msg.attachments.map((f) => <AttachmentView key={f.id} file={f} />)}</div>}
          {msg.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {msg.reactions.map((r) => (
                <button key={r.emoji} onClick={() => react(r.emoji)} disabled={!canReact}
                  title={r.users.map((u) => displayName(u, msg.serverId)).join(', ')}
                  className={cx('flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-sm transition',
                    r.users.includes(me.id) ? 'border-brand-500 bg-brand-500/20 text-brand-300' : 'border-transparent bg-ink-700 hover:border-ink-500')}>
                  <span>{r.emoji}</span><span className="text-xs font-semibold">{r.users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!editing && !msg.pending && (
        <div className="absolute -top-4 right-4 hidden items-center rounded-lg border border-ink-600 bg-ink-850 p-0.5 shadow-pop group-hover:flex">
          {canReact && <button className="btn-icon" aria-label="Ajouter une réaction" title="Réagir" onClick={(e) => pickReaction(e.currentTarget)}><SmilePlus size={17} /></button>}
          <button className="btn-icon" aria-label="Répondre" title="Répondre" onClick={() => onReply(msg)}><CornerUpLeft size={17} /></button>
          {mine && <button className="btn-icon" aria-label="Modifier" title="Modifier" onClick={() => { setDraft(msg.content); setEditing(msg.id); }}><Pencil size={16} /></button>}
          {canPin && <button className="btn-icon" aria-label={msg.pinned ? 'Désépingler' : 'Épingler'} title={msg.pinned ? 'Désépingler' : 'Épingler'} onClick={() => run(emit('message:pin', { messageId: msg.id, pinned: !msg.pinned }))}><Pin size={16} /></button>}
          {!mine && msg.author && <button className="btn-icon" aria-label="Signaler" title="Signaler" onClick={() => openModal({ kind: 'report', userId: msg.author!.id, messageId: msg.id })}><Flag size={16} /></button>}
          {(mine || canModerate) && <button className="btn-icon hover:text-bad" aria-label="Supprimer" title="Supprimer" onClick={remove}><Trash2 size={16} /></button>}
        </div>
      )}
    </div>
  );
});
