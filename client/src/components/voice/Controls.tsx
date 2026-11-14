import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useStore } from '../../lib/store';
import { cx } from '../../lib/format';
import { voice } from '../../voice/voice';

function Round({ on, danger, label, onClick, children, disabled }: { on?: boolean; danger?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={cx('grid h-12 w-12 place-items-center rounded-full transition-all hover:scale-105 active:scale-95 disabled:opacity-40',
        danger ? 'bg-bad text-white hover:brightness-110' : on ? 'bg-white text-ink-900' : 'bg-ink-600 text-white hover:bg-ink-500')}>
      {children}
    </button>
  );
}

export function VoiceControls() {
  const v = useStore((s) => s.voice);
  return (
    <div className="flex items-center justify-center gap-3">
      <Round label={v.muted ? 'Réactiver le micro' : 'Couper le micro'} onClick={() => voice.setMuted(!v.muted)} on={v.muted}>{v.muted ? <MicOff size={20} className="text-bad" /> : <Mic size={20} />}</Round>
      <Round label={v.deafened ? 'Réactiver le son' : 'Couper le son'} onClick={() => voice.setDeafened(!v.deafened)} on={v.deafened}>{v.deafened ? <HeadphoneOff size={20} className="text-bad" /> : <Headphones size={20} />}</Round>
      <Round label={v.camera ? 'Couper la caméra' : 'Activer la caméra'} onClick={() => voice.toggleCamera()} on={v.camera} disabled={!v.canStream}>{v.camera ? <Video size={20} /> : <VideoOff size={20} />}</Round>
      <Round label={v.screen ? "Arrêter le partage d'écran" : "Partager l'écran"} onClick={() => voice.toggleScreen()} on={v.screen} disabled={!v.canStream}><Monitor size={20} /></Round>
      <Round label="Raccrocher" danger onClick={() => voice.leave()}><PhoneOff size={20} /></Round>
    </div>
  );
}
