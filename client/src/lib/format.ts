export const sameDay = (a: string | number | Date, b: string | number | Date) => new Date(a).toDateString() === new Date(b).toDateString();
export const hour = (d: string | number | Date) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const day = (d: string | number | Date) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export function full(d: string | number | Date) {
  if (sameDay(d, Date.now())) return `Aujourd'hui à ${hour(d)}`;
  if (sameDay(d, Date.now() - 864e5)) return `Hier à ${hour(d)}`;
  return `${new Date(d).toLocaleDateString('fr-FR')} ${hour(d)}`;
}
export function size(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1048576).toFixed(1)} Mo`;
}
export const STATUS_LABEL: Record<string, string> = { online: 'En ligne', idle: 'Absent', dnd: 'Occupé', invisible: 'Invisible', offline: 'Hors ligne' };
export const STATUS_COLOR: Record<string, string> = { online: 'bg-ok', idle: 'bg-warn', dnd: 'bg-bad', invisible: 'bg-zinc-500', offline: 'bg-zinc-500' };
const PALETTE = ['#7b5cff', '#3ec97e', '#f0b232', '#ef4f5a', '#38bdf8', '#e879f9', '#fb923c', '#a3e635'];
export const colorFor = (id: number) => PALETTE[Math.abs(id) % PALETTE.length];
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
