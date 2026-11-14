// Mise en forme des messages, construite en éléments React (jamais de HTML brut : aucun risque XSS).
import { useState, type ReactNode } from 'react';

const INLINE = /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\|\|[\s\S]+?\|\|)|(\*[^*\n]+\*)|((?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))|(<@\d+>)|(@everyone|@here)|(https?:\/\/[^\s<>]+)/gu;

export interface MdContext { nameOf: (id: number) => string; onMention?: (id: number, el: HTMLElement) => void; myId?: number }

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return <span className={`spoiler ${shown ? 'shown' : ''}`} onClick={() => setShown(true)} title={shown ? undefined : 'Cliquer pour révéler'}>{children}</span>;
}

function inline(text: string, ctx: MdContext, key = 'k'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    last = m.index! + t.length;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), ctx, k)}</strong>);
    else if (m[3]) out.push(<u key={k}>{inline(t.slice(2, -2), ctx, k)}</u>);
    else if (m[4]) out.push(<s key={k}>{inline(t.slice(2, -2), ctx, k)}</s>);
    else if (m[5]) out.push(<Spoiler key={k}>{inline(t.slice(2, -2), ctx, k)}</Spoiler>);
    else if (m[6] || m[7]) out.push(<em key={k}>{inline(t.slice(1, -1), ctx, k)}</em>);
    else if (m[8]) {
      const id = Number(t.slice(2, -1));
      out.push(<span key={k} onClick={(e) => ctx.onMention?.(id, e.currentTarget)}
        className={`cursor-pointer rounded px-0.5 font-medium transition ${id === ctx.myId ? 'bg-warn/25 text-amber-200' : 'bg-brand-500/25 text-brand-300 hover:bg-brand-500 hover:text-white'}`}>@{ctx.nameOf(id)}</span>);
    } else if (m[9]) out.push(<span key={k} className="rounded bg-brand-500/25 px-0.5 font-medium text-brand-300">{t}</span>);
    else {
      const trail = t.match(/[.,;:!?)]+$/)?.[0] ?? '';
      const url = trail ? t.slice(0, -trail.length) : t;
      out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>, trail);
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, ctx }: { text: string; ctx: MdContext }) {
  const parts = text.split(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/g);
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index % 2) {
      out.push(<pre key={index}><code>{part.replace(/\n$/, '')}</code></pre>);
      return;
    }
    const clean = part.replace(index > 0 ? /^\n/ : /^$/, '').replace(index < parts.length - 1 ? /\n$/ : /^$/, '');
    if (!clean) return;
    let normal: string[] = [];
    let quote: string[] = [];
    const flush = () => {
      if (normal.length) out.push(<span key={`${index}-n${out.length}`}>{inline(normal.join('\n'), ctx, `${index}-${out.length}`)}</span>);
      if (quote.length) out.push(<blockquote key={`${index}-q${out.length}`}>{inline(quote.join('\n'), ctx, `${index}-${out.length}`)}</blockquote>);
      normal = [];
      quote = [];
    };
    for (const line of clean.split('\n')) {
      if (line.startsWith('> ')) { if (normal.length) flush(); quote.push(line.slice(2)); }
      else { if (quote.length) flush(); normal.push(line); }
    }
    flush();
  });
  return <div className="md-content whitespace-pre-wrap break-words leading-relaxed">{out}</div>;
}
