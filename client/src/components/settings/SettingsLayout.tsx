import { useState, type ReactNode } from 'react';
import { cx } from '../../lib/format';

export interface Tab { id: string; label: string; render: () => ReactNode; danger?: boolean; onClick?: () => void }

export function SettingsLayout({ title, tabs, initialTab, footer }: { title: string; tabs: Tab[]; initialTab?: string; footer?: ReactNode }) {
  const [tab, setTab] = useState(tabs.find((t) => t.id === initialTab)?.id ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto bg-ink-850 p-3 md:w-56 md:flex-col md:overflow-y-auto md:p-4">
        <h2 className="section-title hidden truncate px-2 pb-2 md:block">{title}</h2>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => (t.onClick ? t.onClick() : setTab(t.id))}
            className={cx('shrink-0 rounded-md px-2.5 py-1.5 text-left text-[15px] transition-colors',
              t.danger ? 'text-bad hover:bg-bad/10' : current?.id === t.id ? 'bg-ink-600 text-white' : 'text-zinc-400 hover:bg-ink-700 hover:text-zinc-200')}>
            {t.label}
          </button>
        ))}
        {footer}
      </nav>
      <section className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
        <h2 className="mb-5 text-xl font-bold">{current?.label}</h2>
        {current?.render()}
      </section>
    </div>
  );
}
