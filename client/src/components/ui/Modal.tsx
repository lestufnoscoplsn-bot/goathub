import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cx } from '../../lib/format';

export function Modal({ children, onClose, wide, className, label }: { children: ReactNode; onClose: () => void; wide?: boolean; className?: string; label?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className={cx('card relative max-h-[calc(100vh-2rem)] w-full animate-pop-in overflow-y-auto', wide ? 'max-w-5xl' : 'max-w-md', className)}>
        <button className="btn-icon absolute right-3 top-3 z-10" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
