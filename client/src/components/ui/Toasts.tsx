import { useStore } from '../../lib/store';
import { cx } from '../../lib/format';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cx('animate-slide-up rounded-xl border px-4 py-2.5 text-sm shadow-pop',
          t.tone === 'error' ? 'border-bad/40 bg-[#2a1418] text-red-200' : t.tone === 'success' ? 'border-ok/40 bg-[#10231a] text-emerald-200' : 'border-ink-600 bg-ink-900 text-zinc-100')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
