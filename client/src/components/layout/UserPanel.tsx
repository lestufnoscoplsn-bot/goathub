import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, PhoneOff, Settings, Signal, Video, VideoOff, Smile, Pencil } from 'lucide-react';
import { ConnectionQuality } from 'livekit-client';
import { navigate } from '../../lib/router';
import { emit } from '../../lib/socket';
import { dmName, findChannelServer, openModal, toast, useStore } from '../../lib/store';
import { cx, STATUS_COLOR, STATUS_LABEL } from '../../lib/format';
import { voice } from '../../voice/voice';
import { Avatar } from '../ui/Avatar';
import { Menu, openPopover } from '../ui/Menu';

function VoiceBar() {
  const v = useStore((s) => s.voice);
  const me = useStore((s) => s.me!);
  const dms = useStore((s) => s.dms);
  useStore((s) => s.servers);
  if (!v.channelId) return null;
  const server = findChannelServer(v.channelId);
  const channel = server?.channels.find((c) => c.id === v.channelId);
  const dm = dms.find((d) => d.id === v.channelId);
  const quality = v.quality[me.id];
  const qualityLabel = quality === ConnectionQuality.Excellent ? 'Excellente' : quality === ConnectionQuality.Good ? 'Bonne' : quality === ConnectionQuality.Poor ? 'Faible' : 'En cours';
  const go = () => navigate(server ? `/channels/${server.id}/${v.channelId}` : `/channels/@me/${v.channelId}`);
  return (
    <div className="border-b border-ink-700 bg-ink-900 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <button onClick={go} className="min-w-0 flex-1 text-left">
          <div className={cx('flex items-center gap-1.5 text-sm font-bold', v.connecting ? 'text-warn' : 'text-ok')}>
            <Signal size={15} />{v.connecting ? 'Connexion…' : 'Voix connectée'}
          </div>
          <div className="truncate text-xs text-zinc-400 hover:underline" title={`Qualité : ${qualityLabel}`}>
            {channel ? `${channel.name} / ${server!.name}` : dm ? `Appel · ${dmName(dm)}` : ''}
          </div>
        </button>
        <button className="btn-icon text-zinc-300 hover:bg-bad hover:text-white" aria-label="Se déconnecter du vocal" title="Se déconnecter" onClick={() => voice.leave()}><PhoneOff size={18} /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button onClick={() => voice.toggleCamera()} disabled={!v.canStream} title={v.camera ? 'Couper la caméra' : 'Activer la caméra'}
          className={cx('btn py-1.5', v.camera ? 'bg-brand-500 text-white' : 'bg-ink-700 text-zinc-200 hover:bg-ink-600')}>
          {v.camera ? <Video size={16} /> : <VideoOff size={16} />}<span className="sr-only">Caméra</span>
        </button>
        <button onClick={() => voice.toggleScreen()} disabled={!v.canStream} title={v.screen ? "Arrêter le partage d'écran" : "Partager l'écran"}
          className={cx('btn py-1.5', v.screen ? 'bg-brand-500 text-white' : 'bg-ink-700 text-zinc-200 hover:bg-ink-600')}>
          <Monitor size={16} /><span className="sr-only">Partager l'écran</span>
        </button>
      </div>
    </div>
  );
}

export function UserPanel() {
  const me = useStore((s) => s.me!);
  const v = useStore((s) => s.voice);
  const setStatus = (status: string) => emit('status:set', { status }).then(() => useStore.setState((s) => ({ me: { ...s.me!, statusPref: status as never } }))).catch((e) => toast(e.message, 'error'));
  const statusMenu = (el: Element) => openPopover(el, <Menu items={[
    ...(['online', 'idle', 'dnd', 'invisible'] as const).map((st) => ({
      label: STATUS_LABEL[st], hint: me.statusPref === st ? '✓' : undefined,
      icon: <span className={cx('h-2.5 w-2.5 rounded-full', STATUS_COLOR[st])} />, onClick: () => setStatus(st),
    })),
    'sep',
    { label: me.customStatus ? 'Modifier le statut personnalisé' : 'Définir un statut personnalisé', icon: <Smile size={15} />, onClick: () => openModal({
      kind: 'prompt', title: 'Statut personnalisé', label: 'Que fais-tu en ce moment ?', value: me.customStatus, maxLength: 80, confirm: 'Enregistrer', allowEmpty: true,
      onSubmit: (customStatus) => emit('profile:update', { customStatus }),
    }) },
    { label: 'Modifier mon profil', icon: <Pencil size={15} />, onClick: () => openModal({ kind: 'userSettings', tab: 'profile' }) },
  ]} />, 'top');
  return (
    <div className="shrink-0 bg-ink-900/80">
      <VoiceBar />
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button onClick={(e) => statusMenu(e.currentTarget)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-ink-700" title="Changer de statut">
          <Avatar user={me} size={34} status speaking={!!v.speaking[me.id] && !v.muted} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{me.username}</div>
            <div className="truncate text-xs text-zinc-400">{me.customStatus || STATUS_LABEL[me.statusPref]}</div>
          </div>
        </button>
        <button className={cx('btn-icon', (v.muted || !v.canSpeak) && 'text-bad')} onClick={() => voice.setMuted(!v.muted)}
          aria-label={v.muted ? 'Réactiver le micro' : 'Couper le micro'} title={v.muted ? 'Réactiver le micro' : 'Couper le micro'}>
          {v.muted ? <MicOff size={19} /> : <Mic size={19} />}
        </button>
        <button className={cx('btn-icon', v.deafened && 'text-bad')} onClick={() => voice.setDeafened(!v.deafened)}
          aria-label={v.deafened ? 'Réactiver le son' : 'Couper le son'} title={v.deafened ? 'Réactiver le son' : 'Couper le son (casque)'}>
          {v.deafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
        </button>
        <button className="btn-icon" onClick={() => openModal({ kind: 'userSettings' })} aria-label="Paramètres" title="Paramètres"><Settings size={19} /></button>
      </div>
    </div>
  );
}
