// Scène vocale : une tuile par participant, plus les écrans partagés et caméras.
import { Track, type Participant, type TrackPublication } from 'livekit-client';
import { HeadphoneOff, Maximize2, MicOff, Minimize2, Monitor } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { displayName, useStore, NO_VOICE } from '../../lib/store';
import { cx } from '../../lib/format';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { openContextMenu } from '../ui/Menu';
import { UserMenu } from '../UserMenu';

let version = 0;
voice.subscribe(() => { version++; });
const useTracksVersion = () => useSyncExternalStore((cb) => voice.subscribe(cb), () => version);

function participantOf(userId: number): Participant | undefined {
  const room = voice.room;
  if (!room) return undefined;
  if (room.localParticipant.identity === String(userId)) return room.localParticipant;
  return room.remoteParticipants.get(String(userId));
}

function VideoTrack({ pub, contain, mirror }: { pub: TrackPublication; contain?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const track = pub.track;
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [pub, pub.track]);
  return <video ref={ref} autoPlay playsInline muted className={cx('absolute inset-0 h-full w-full bg-black', contain ? 'object-contain' : 'object-cover', mirror && '-scale-x-100')} />;
}

interface Tile { key: string; userId: number; kind: 'user' | 'screen'; pub?: TrackPublication }

export function Stage({ channelId, serverId, compact }: { channelId: number; serverId?: number; compact?: boolean }) {
  useTracksVersion();
  const users = useStore((s) => s.voiceStates[channelId] ?? NO_VOICE);
  const all = useStore((s) => s.users);
  const v = useStore((s) => s.voice);
  const me = useStore((s) => s.me!.id);
  const [focus, setFocus] = useState<string | null>(null);
  const connected = v.channelId === channelId;

  const tiles: Tile[] = [];
  for (const u of users) {
    const p = connected ? participantOf(u.userId) : undefined;
    const cam = p?.getTrackPublication(Track.Source.Camera);
    tiles.push({ key: `u${u.userId}`, userId: u.userId, kind: 'user', pub: cam && !cam.isMuted && cam.track ? cam : undefined });
    const screen = p?.getTrackPublication(Track.Source.ScreenShare);
    if (screen?.track) tiles.push({ key: `s${u.userId}`, userId: u.userId, kind: 'screen', pub: screen });
    else if (u.screen && !connected) tiles.push({ key: `s${u.userId}`, userId: u.userId, kind: 'screen' });
  }
  const focused = focus ? tiles.find((t) => t.key === focus) : undefined;

  const tile = (t: Tile, big = false) => {
    const state = users.find((u) => u.userId === t.userId)!;
    const speaking = t.kind === 'user' && !!v.speaking[t.userId] && !state?.muted;
    return (
      <div key={t.key} onClick={() => setFocus(focus === t.key ? null : t.key)}
        onContextMenu={(e) => openContextMenu(e, <UserMenu userId={t.userId} serverId={serverId} />)}
        className={cx('group relative grid cursor-pointer place-items-center overflow-hidden rounded-2xl bg-ink-750 transition-all duration-200',
          big ? 'h-full w-full' : compact ? 'aspect-video w-52' : 'aspect-video w-full', speaking && 'speaking')}>
        {t.pub ? <VideoTrack pub={t.pub} contain={t.kind === 'screen'} mirror={t.kind === 'user' && t.userId === me} />
          : t.kind === 'screen'
            ? <div className="flex flex-col items-center gap-2 text-zinc-400"><Monitor size={32} /><span className="text-sm">{connected ? 'Chargement du partage…' : 'Rejoins le salon pour regarder'}</span></div>
            : <Avatar user={all[t.userId]} size={compact ? 56 : big ? 112 : 80} speaking={speaking} />}
        <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium backdrop-blur">
          {t.kind === 'screen' && <Monitor size={12} className="text-bad" />}
          <span className="truncate">{t.kind === 'screen' ? `Écran de ${displayName(t.userId, serverId)}` : displayName(t.userId, serverId)}</span>
          {t.kind === 'user' && (state?.serverMuted ? <MicOff size={12} className="text-bad" /> : state?.muted && <MicOff size={12} />)}
          {t.kind === 'user' && state?.deafened && <HeadphoneOff size={12} />}
        </div>
        <span className="absolute right-2 top-2 hidden rounded-md bg-black/60 p-1 group-hover:block">{big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</span>
      </div>
    );
  };

  if (!users.length) return null;
  if (focused) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <div className="min-h-0 flex-1">{tile(focused, true)}</div>
        <div className="flex shrink-0 justify-center gap-3 overflow-x-auto">{tiles.filter((t) => t.key !== focused.key).map((t) => <div key={t.key} className="w-44 shrink-0">{tile(t)}</div>)}</div>
      </div>
    );
  }
  const cols = tiles.length <= 1 ? 'grid-cols-1 max-w-3xl' : tiles.length <= 4 ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl' : 'grid-cols-2 lg:grid-cols-3';
  if (compact) return <div className="flex flex-wrap justify-center gap-3 p-4">{tiles.map((t) => tile(t))}</div>;
  return <div className="flex h-full items-center justify-center overflow-y-auto p-4"><div className={cx('grid w-full gap-3', cols)}>{tiles.map((t) => tile(t))}</div></div>;
}
