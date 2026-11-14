// Menus contextuels (clic droit) et bulles flottantes.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { cx } from '../../lib/format';

interface PopState { content: ReactNode; x: number; y: number; anchor?: DOMRect; side?: 'right' | 'left' | 'top' | 'bottom' }
export const usePopover = create<{ pop: PopState | null }>(() => ({ pop: null }));
export const closePopover = () => usePopover.setState({ pop: null });

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault(): void }, content: ReactNode) {
  e.preventDefault();
  usePopover.setState({ pop: { content, x: e.clientX, y: e.clientY } });
}
export function openPopover(el: Element, content: ReactNode, side: PopState['side'] = 'right') {
  const r = el.getBoundingClientRect();
  usePopover.setState({ pop: { content, x: r.right, y: r.top, anchor: r, side } });
}

export function PopoverLayer() {
  const pop = usePopover((s) => s.pop);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!pop || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    let left = pop.x;
    let top = pop.y;
    if (pop.anchor) {
      const a = pop.anchor;
      if (pop.side === 'left') { left = a.left - width - 8; top = a.top; }
      else if (pop.side === 'top') { left = a.left; top = a.top - height - 8; }
      else if (pop.side === 'bottom') { left = a.left; top = a.bottom + 8; }
      else { left = a.right + 8; top = a.top; }
    }
    setPos({ left: Math.max(8, Math.min(left, innerWidth - width - 8)), top: Math.max(8, Math.min(top, innerHeight - height - 8)) });
  }, [pop]);
  useEffect(() => {
    if (!pop) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && closePopover();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closePopover();
    setTimeout(() => window.addEventListener('mousedown', down), 0);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [pop]);
  if (!pop) return null;
  return <div ref={ref} className="fixed z-[60] animate-pop-in" style={pos}>{pop.content}</div>;
}

export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void; hint?: string }
export function Menu({ items }: { items: (MenuItem | 'sep' | false | null | undefined)[] }) {
  return (
    <div role="menu" className="min-w-[210px] rounded-xl border border-ink-600 bg-ink-900 p-1.5 shadow-pop">
      {items.filter(Boolean).map((item, i) => item === 'sep'
        ? <div key={i} className="my-1 h-px bg-ink-600" />
        : (
          <button key={i} role="menuitem" onClick={() => { closePopover(); (item as MenuItem).onClick(); }}
            className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
              (item as MenuItem).danger ? 'text-bad hover:bg-bad hover:text-white' : 'text-zinc-200 hover:bg-brand-500 hover:text-white')}>
            {(item as MenuItem).icon}<span className="flex-1">{(item as MenuItem).label}</span>
            {(item as MenuItem).hint && <span className="text-xs opacity-60">{(item as MenuItem).hint}</span>}
          </button>
        ))}
    </div>
  );
}
