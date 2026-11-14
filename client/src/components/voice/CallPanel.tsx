// Panneau d'appel en haut d'une conversation privée.
import { Phone } from 'lucide-react';
import { displayName, useStore, NO_VOICE } from '../../lib/store';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { VoiceControls } from './Controls';
import { Stage } from './Stage';

export function CallPanel({ channelId }: { channelId: number }) {
  const call = useStore((s) => s.calls[channelId]);
  const users = useStore((s) => s.voiceStates[channelId] ?? NO_VOICE);
  const connected = useStore((s) => s.voice.channelId === channelId);
  const all = useStore((s) => s.users);
  return (
    <div className="shrink-0 animate-slide-up border-b border-ink-950 bg-ink-950">
      {users.length > 0 ? <div className="max-h-[50vh] overflow-y-auto"><Stage channelId={channelId} compact /></div> : (
        <div className="flex justify-center gap-3 p-6">
          {call?.ringing.map((id) => <div key={id} className="animate-pulse"><Avatar user={all[id]} size={72} /></div>)}
        </div>
      )}
      {call && call.ringing.length > 0 && (
        <p className="pb-2 text-center text-sm text-zinc-400">Sonnerie chez {call.ringing.map((id) => displayName(id)).join(', ')}…</p>
      )}
      <div className="pb-4">
        {connected ? <VoiceControls /> : (
          <div className="flex justify-center">
            <button className="btn bg-ok px-6 py-2.5 text-white hover:brightness-110" onClick={() => voice.join(channelId)}><Phone size={18} /> Rejoindre l'appel</button>
          </div>
        )}
      </div>
    </div>
  );
}
