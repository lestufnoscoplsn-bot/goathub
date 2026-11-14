// Zone de saisie : texte, mentions avec suggestions, émojis, fichiers (bouton, glisser-déposer, coller), réponse.
import { FileText, PlusCircle, Smile, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { emit, rawEmit, uploadFile } from '../../lib/socket';
import { displayName, get, set, toast, useStore } from '../../lib/store';
import { cx } from '../../lib/format';
import type { Message, User } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { EmojiPicker } from '../ui/EmojiPicker';
import { closePopover, openPopover } from '../ui/Menu';

interface Pending { key: string; file: File; progress: number; id?: string; preview?: string; error?: string }

export function Composer({ channelId, serverId, placeholder, disabledReason, canAttach, replyTo, setReplyTo, people }: {
  channelId: number; serverId?: number; placeholder: string; disabledReason?: string | null; canAttach: boolean;
  replyTo: Message | null; setReplyTo: (m: Message | null) => void; people: User[];
}) {
  const [text, setText] = useState(() => sessionStorage.getItem(`draft:${channelId}`) ?? '');
  const [files, setFiles] = useState<Pending[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const pendingCaret = useRef<number | null>(null); // position du curseur à rétablir après une insertion
  const maxMb = useStore((s) => s.config.maxUploadMb);

  useEffect(() => { sessionStorage.setItem(`draft:${channelId}`, text); }, [text, channelId]);
  useEffect(() => { if (replyTo) ref.current?.focus(); }, [replyTo]);
  // Place le curseur juste après l'insertion, avant que l'utilisateur ne tape la lettre suivante
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);
  useEffect(() => {
    const onDrop = (e: Event) => addFiles((e as CustomEvent<File[]>).detail);
    addEventListener('gh:drop-files', onDrop);
    return () => removeEventListener('gh:drop-files', onDrop);
  });

  const suggestions = mentionQuery === null ? [] : [
    ...people.filter((p) => p.username.toLowerCase().includes(mentionQuery.toLowerCase()) || displayName(p.id, serverId).toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8),
    ...(serverId && 'everyone'.startsWith(mentionQuery.toLowerCase()) ? [{ id: 0, username: 'everyone' } as User] : []),
  ];

  function addFiles(list: File[]) {
    if (!canAttach) return toast("Tu n'as pas la permission d'envoyer des fichiers ici.", 'error');
    for (const file of list) {
      if (files.length >= 10) { toast('10 fichiers maximum par message.'); break; }
      if (file.size > maxMb * 1048576) { toast(`« ${file.name} » dépasse ${maxMb} Mo.`, 'error'); continue; }
      const key = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setFiles((f) => [...f, { key, file, progress: 0, preview }]);
      uploadFile(file, (p) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, progress: p } : x))))
        .then((res) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, id: res.id, progress: 1 } : x))))
        .catch((err) => { toast(err.message, 'error'); setFiles((f) => f.filter((x) => x.key !== key)); });
    }
  }

  // « @pseudo » lisible -> « <@id> » enregistré
  function encode(value: string) {
    const byName = new Map(people.map((p) => [p.username.toLowerCase(), p.id]));
    return value.replace(/@([\p{L}\p{N}_.-]{2,16})/gu, (whole, name: string) => {
      let candidate = name;
      while (candidate.length >= 2) {
        const id = byName.get(candidate.toLowerCase());
        if (id) return `<@${id}>${name.slice(candidate.length)}`;
        if (!/[.-]$/.test(candidate)) break;
        candidate = candidate.slice(0, -1);
      }
      return whole;
    });
  }

  async function send() {
    if (files.some((f) => !f.id)) return toast("Attends la fin de l'envoi des fichiers.");
    const content = encode(text.trim());
    if (!content && !files.length) return;
    const nonce = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const me = get().me!;
    const optimistic: Message = {
      id: -Date.now(), channelId, serverId: serverId ?? null, author: { id: me.id, username: me.username, avatar: me.avatar },
      content, kind: 'default', attachments: [], mentions: [], mentionEveryone: false, replyTo: null, pinned: false, reactions: [],
      createdAt: new Date().toISOString(), editedAt: null, nonce, pending: true,
    };
    const saved = { text, files, replyTo };
    if (!files.length) {
      set((s) => {
        const cache = s.messages[channelId];
        return cache ? { messages: { ...s.messages, [channelId]: { ...cache, list: [...cache.list, optimistic] } } } : {};
      });
      dispatchEvent(new CustomEvent('gh:sent'));
    }
    setText('');
    setFiles([]);
    setReplyTo(null);
    try {
      await emit('message:send', { channelId, content, replyTo: replyTo?.id, attachmentIds: saved.files.map((f) => f.id), nonce });
    } catch (err) {
      set((s) => {
        const cache = s.messages[channelId];
        return cache ? { messages: { ...s.messages, [channelId]: { ...cache, list: cache.list.filter((m) => m.nonce !== nonce) } } } : {};
      });
      setText(saved.text);
      setFiles(saved.files);
      setReplyTo(saved.replyTo);
      toast((err as Error).message, 'error');
    }
  }

  function updateMention(value: string, caret: number) {
    const m = value.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}_.-]{0,16})$/u);
    setMentionQuery(m ? m[1] : null);
    setMentionIndex(0);
  }

  function applyMention(user: User) {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@[\p{L}\p{N}_.-]{0,16}$/u, `@${user.username} `);
    const next = before + text.slice(caret);
    pendingCaret.current = before.length;
    setText(next);
    setMentionQuery(null);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(suggestions[mentionIndex]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
    else if (e.key === 'Escape' && replyTo) setReplyTo(null);
    else if (e.key === 'ArrowUp' && !text) {
      const mine = [...(get().messages[channelId]?.list ?? [])].reverse().find((m) => m.author?.id === get().me?.id && m.kind === 'default' && !m.pending);
      if (mine) { e.preventDefault(); dispatchEvent(new CustomEvent('gh:edit-last', { detail: mine.id })); }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  }

  const insertEmoji = (emoji: string) => {
    const el = ref.current!;
    const start = el.selectionStart;
    pendingCaret.current = start + emoji.length;
    setText(text.slice(0, start) + emoji + text.slice(el.selectionEnd));
  };

  if (disabledReason) {
    return <div className="mx-4 mb-6 rounded-xl bg-ink-750 px-4 py-3 text-sm text-zinc-400">{disabledReason}</div>;
  }

  return (
    <div className="relative px-4 pb-1">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 animate-slide-up rounded-xl border border-ink-600 bg-ink-900 p-1.5 shadow-pop" role="listbox">
          <div className="section-title px-2 pb-1">Membres</div>
          {suggestions.map((u, i) => (
            <button key={u.id} role="option" aria-selected={i === mentionIndex} onMouseDown={(e) => { e.preventDefault(); applyMention(u); }}
              className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === mentionIndex ? 'bg-ink-600' : 'hover:bg-ink-700')}>
              {u.id ? <Avatar user={u} size={24} /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-xs">@</span>}
              <span className="font-medium">{u.id ? displayName(u.id, serverId) : '@everyone'}</span>
              <span className="text-xs text-zinc-500">{u.id ? u.username : 'Prévenir tout le monde'}</span>
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="flex items-center gap-2 rounded-t-xl bg-ink-850 px-4 py-2 text-sm text-zinc-400">
          <span className="flex-1 truncate">Réponse à <b className="text-zinc-200">{replyTo.author ? displayName(replyTo.author.id, serverId) : '?'}</b></span>
          <button className="btn-icon h-6 w-6" onClick={() => setReplyTo(null)} aria-label="Annuler la réponse"><X size={15} /></button>
        </div>
      )}
      {files.length > 0 && (
        <div className={cx('flex gap-3 overflow-x-auto bg-ink-750 p-3', !replyTo && 'rounded-t-xl')}>
          {files.map((f) => (
            <div key={f.key} className="relative w-36 shrink-0 rounded-lg bg-ink-850 p-2">
              {f.preview ? <img src={f.preview} alt="" className="h-24 w-full rounded object-cover" /> : <div className="grid h-24 place-items-center"><FileText size={36} className="text-brand-400" /></div>}
              <div className="mt-1 truncate text-xs">{f.file.name}</div>
              {!f.id && <div className="mt-1 h-1 rounded bg-ink-600"><div className="h-1 rounded bg-brand-500 transition-all" style={{ width: `${f.progress * 100}%` }} /></div>}
              <button className="btn-icon absolute right-1 top-1 h-6 w-6 bg-ink-900/80" aria-label="Retirer" onClick={() => setFiles((x) => x.filter((p) => p.key !== f.key))}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className={cx('flex items-end gap-1 bg-ink-750 px-2', replyTo || files.length ? 'rounded-b-xl' : 'rounded-xl')}>
        {canAttach && (
          <button className="btn-icon mb-1.5 h-9 w-9" aria-label="Joindre un fichier" title="Joindre un fichier" onClick={() => fileInput.current?.click()}><PlusCircle size={22} /></button>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <textarea ref={ref} value={text} rows={1} maxLength={2000} placeholder={placeholder} aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target.value, e.target.selectionStart);
            if (e.target.value && Date.now() - lastTyping.current > 3500) { lastTyping.current = Date.now(); rawEmit('typing', { channelId }); }
          }}
          onKeyDown={onKey} onPaste={onPaste} onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
          className="max-h-60 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-[15px] outline-none placeholder:text-zinc-500" />
        <button className="btn-icon mb-1.5 h-9 w-9" aria-label="Émojis" title="Émojis"
          onClick={(e) => openPopover(e.currentTarget, <EmojiPicker onPick={(em) => { closePopover(); insertEmoji(em); }} />, 'top')}><Smile size={22} /></button>
      </div>
    </div>
  );
}
