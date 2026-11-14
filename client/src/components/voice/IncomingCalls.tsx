// Fenêtre d'appel entrant (sonnerie, accepter, refuser).
import { Phone, PhoneOff } from 'lucide-react';
import { useEffect } from 'react';
import { navigate } from '../../lib/router';
import { emit } from '../../lib/socket';
import { dmName, toast, useStore } from '../../lib/store';
import { sounds } from '../../lib/sounds';
import { notifyText } from '../../lib/notify';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';

export function IncomingCalls() {
  const me = useStore((s) => s.me!.id);
  const calls = useStore((s) => s.calls);
  const dms = useStore((s) => s.dms);
  const users = useStore((s) => s.users);
  const myChannel = useStore((s) => s.voice.channelId);
  const dnd = useStore((s) => s.me?.statusPref === 'dnd');
  const ringing = Object.values(calls).filter((c) => c.ringing.includes(me) && myChannel !== c.channelId);
  const first = ringing[0];

  useEffect(() => {
    if (!first || dnd) return;
    sounds.ring();
    const caller = users[first.startedBy ?? 0]?.username ?? "Quelqu'un";
    notifyText(`${caller} t'appelle`, 'Appel entrant sur GoatHub', `/channels/@me/${first.channelId}`);
    const t = setInterval(() => sounds.ring(), 2200);
    return () => clearInterval(t);
  }, [first?.channelId, dnd]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!first) return null;
  const dm = dms.find((d) => d.id === first.channelId);
  const caller = users[first.startedBy ?? 0];
  const accept = async () => { navigate(`/channels/@me/${first.channelId}`); await voice.join(first.channelId); };
  const decline = () => emit('call:decline', { channelId: first.channelId }).catch((e) => toast(e.message, 'error'));
  return (
    <div role="alertdialog" aria-label="Appel entrant" className="fixed left-1/2 top-4 z-[65] w-[320px] -translate-x-1/2 animate-pop-in rounded-2xl border border-ink-600 bg-ink-900 p-5 text-center shadow-pop">
      <div className="mx-auto w-fit animate-pulse2 rounded-full"><Avatar user={caller} size={80} /></div>
      <div className="mt-3 text-lg font-bold">{caller?.username ?? 'Appel'}</div>
      <div className="text-sm text-zinc-400">{dm?.type === 'group' ? `Appel de groupe · ${dmName(dm)}` : 'Appel entrant…'}</div>
      <div className="mt-5 flex justify-center gap-6">
        <button onClick={decline} aria-label="Refuser" title="Refuser" className="grid h-14 w-14 place-items-center rounded-full bg-bad text-white transition hover:scale-105"><PhoneOff size={24} /></button>
        <button onClick={accept} aria-label="Accepter" title="Accepter" className="grid h-14 w-14 place-items-center rounded-full bg-ok text-white transition hover:scale-105"><Phone size={24} className="animate-ring" /></button>
      </div>
    </div>
  );
}
