// Le vocal, avec LiveKit (serveur vocal SFU) : chacun envoie son son une seule fois au serveur,
// qui le redistribue aux autres. Ça permet des salons à plusieurs avec une bonne qualité.
import {
  AudioPresets, ConnectionQuality, DisconnectReason, Room, RoomEvent, Track,
  type Participant, type RemoteParticipant, type RemoteTrack,
} from 'livekit-client';
import { emit, rawEmit } from '../lib/socket';
import { emptyVoice, findChannelServer, get, set, toast } from '../lib/store';
import { local } from '../lib/storage';
import { sounds } from '../lib/sounds';

export interface AudioSettings {
  inputId: string;
  outputId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
}

export const audioSettings = (): AudioSettings => local.get('audio', {
  inputId: 'default', outputId: 'default', noiseSuppression: true, echoCancellation: true, autoGain: true,
});

export const userVolume = (userId: number) => local.get(`vol:${userId}`, 1);

class VoiceManager {
  room: Room | null = null;
  private audioBox: HTMLDivElement | null = null;
  private listeners = new Set<() => void>();
  private joining = 0;

  /** Pour l'affichage : prévient les composants quand les pistes (écran, caméra) changent. */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private changed() { this.listeners.forEach((fn) => fn()); }

  serverOf(): number | null {
    const channelId = get().voice.channelId;
    return channelId ? findChannelServer(channelId)?.id ?? null : null;
  }

  private patch(p: Partial<typeof emptyVoice>) {
    set((s) => ({ voice: { ...s.voice, ...p } }));
  }

  async join(channelId: number): Promise<void> {
    const current = get().voice;
    if (current.channelId === channelId && this.room) return;
    if (!window.isSecureContext || !navigator.mediaDevices) {
      toast('Le vocal nécessite une connexion sécurisée (https).', 'error');
      return;
    }
    await this.leave(true); // quitte d'abord l'ancien salon (ce qui annule toute tentative en cours)
    const attempt = ++this.joining;
    this.patch({ channelId, connecting: true, error: null, speaking: {}, screen: false, camera: false });
    try {
      const { token, canSpeak, canStream, serverMuted } = await emit<{ token: string; canSpeak: boolean; canStream: boolean; serverMuted: boolean }>('voice:token', { channelId });
      if (attempt !== this.joining) return;
      const settings = audioSettings();
      const room = new Room({
        adaptiveStream: true,          // la vidéo n'est reçue qu'à la taille affichée
        dynacast: true,                // n'envoie que les qualités réellement regardées
        webAudioMix: true,             // permet de monter le volume d'une personne au-delà de 100 %
        disconnectOnPageLeave: true,
        audioCaptureDefaults: {
          deviceId: settings.inputId,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGain,
        },
        audioOutput: { deviceId: settings.outputId },
        publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, red: true, screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } },
      });
      this.bind(room, channelId);
      await room.connect(get().livekitUrl, token, { autoSubscribe: true });
      if (attempt !== this.joining) { await room.disconnect(); return; }
      this.room = room;
      const muted = get().voice.muted || get().voice.deafened || serverMuted || !canSpeak;
      if (canSpeak) {
        try {
          await room.localParticipant.setMicrophoneEnabled(!muted);
        } catch {
          toast("Impossible d'accéder au micro : vérifie qu'il est branché et autorisé.", 'error');
          this.patch({ muted: true });
        }
      }
      this.patch({ connecting: false, canSpeak, canStream, muted: muted && get().voice.muted ? true : muted });
      await emit('voice:joined', { channelId, muted: get().voice.muted || muted, deafened: get().voice.deafened });
      this.applyVolumes();
      sounds.join();
      this.changed();
    } catch (err) {
      if (attempt !== this.joining) return;
      await this.room?.disconnect();
      this.room = null;
      this.patch({ ...emptyVoice, muted: get().voice.muted, deafened: get().voice.deafened });
      toast((err as Error).message || 'Connexion au vocal impossible.', 'error');
    }
  }

  private bind(room: Room, channelId: number) {
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          this.audioBox ??= Object.assign(document.body.appendChild(document.createElement('div')), { hidden: true });
          const el = track.attach();
          el.dataset.participant = participant.identity;
          this.audioBox.appendChild(el);
          this.applyVolumes();
        }
        this.changed();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        this.changed();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.patch({ speaking: Object.fromEntries(speakers.map((p) => [Number(p.identity), true])) });
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
        set((s) => ({ voice: { ...s.voice, quality: { ...s.voice.quality, [Number(participant.identity)]: quality } } }));
      })
      .on(RoomEvent.ParticipantConnected, () => { this.applyVolumes(); this.changed(); })
      .on(RoomEvent.ParticipantDisconnected, () => this.changed())
      .on(RoomEvent.TrackMuted, () => this.changed())
      .on(RoomEvent.TrackUnmuted, () => this.changed())
      .on(RoomEvent.LocalTrackPublished, () => this.changed())
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Le partage a été arrêté depuis le navigateur (« Arrêter le partage »)
        if (pub.source === Track.Source.ScreenShare) { this.patch({ screen: false }); this.syncState(); }
        if (pub.source === Track.Source.Camera) { this.patch({ camera: false }); this.syncState(); }
        this.changed();
      })
      .on(RoomEvent.Reconnecting, () => this.patch({ connecting: true }))
      .on(RoomEvent.Reconnected, () => {
        this.patch({ connecting: false });
        void emit('voice:joined', { channelId, muted: get().voice.muted, deafened: get().voice.deafened }).catch(() => {});
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) toast('Clique n’importe où pour activer le son du vocal.');
      })
      .on(RoomEvent.MediaDevicesError, () => toast('Problème avec le micro ou la caméra.', 'error'))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (this.room !== room) return;
        this.room = null;
        this.cleanupAudio();
        const was = get().voice.channelId;
        this.patch({ ...emptyVoice, muted: get().voice.muted, deafened: get().voice.deafened });
        if (was) rawEmit('voice:leave', { channelId: was });
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) toast('Tu as été déconnecté du salon vocal.');
        else if (reason !== DisconnectReason.CLIENT_INITIATED) toast('Connexion vocale perdue.', 'error');
        this.changed();
      });
    // Le navigateur bloque parfois le son tant qu'on n'a pas cliqué : on le débloque au premier clic
    const unlock = () => { void room.startAudio(); };
    document.addEventListener('click', unlock, { once: true });
  }

  private cleanupAudio() {
    this.audioBox?.replaceChildren();
  }

  async leave(silent = false) {
    this.joining++;
    const room = this.room;
    const channelId = get().voice.channelId;
    this.room = null;
    if (room) {
      await room.disconnect();
      if (!silent) sounds.leave();
    }
    this.cleanupAudio();
    if (channelId) rawEmit('voice:leave', { channelId });
    this.patch({ ...emptyVoice, muted: get().voice.muted, deafened: get().voice.deafened });
    this.changed();
  }

  private syncState() {
    const v = get().voice;
    if (v.channelId) rawEmit('voice:state', { muted: v.muted, deafened: v.deafened, video: v.camera, screen: v.screen });
  }

  async setMuted(muted: boolean) {
    const v = get().voice;
    if (!muted && v.channelId && !v.canSpeak) {
      toast("Un modérateur t'a rendu muet dans ce salon.", 'error');
      return;
    }
    if (!muted && v.deafened) await this.setDeafened(false);
    this.patch({ muted });
    local.set('muted', muted);
    if (this.room) {
      try {
        await this.room.localParticipant.setMicrophoneEnabled(!muted);
      } catch {
        toast("Impossible d'accéder au micro.", 'error');
        this.patch({ muted: true });
      }
    }
    if (muted) sounds.mute(); else sounds.unmute();
    this.syncState();
  }

  async setDeafened(deafened: boolean) {
    this.patch({ deafened });
    local.set('deafened', deafened);
    this.applyVolumes();
    if (deafened && !get().voice.muted) {
      this.patch({ muted: true });
      await this.room?.localParticipant.setMicrophoneEnabled(false);
    } else if (!deafened && !local.get('muted', false) && get().voice.canSpeak) {
      this.patch({ muted: false });
      await this.room?.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    }
    if (deafened) sounds.mute(); else sounds.unmute();
    this.syncState();
  }

  /** Volume d'une personne (0 à 2 = 200 %), mémorisé sur cet appareil. */
  setUserVolume(userId: number, volume: number) {
    local.set(`vol:${userId}`, volume);
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.room) return;
    const deaf = get().voice.deafened;
    for (const p of this.room.remoteParticipants.values()) {
      p.setVolume(deaf ? 0 : userVolume(Number(p.identity)), Track.Source.Microphone);
      p.setVolume(deaf ? 0 : 1, Track.Source.ScreenShareAudio);
    }
  }

  async toggleScreen() {
    if (!this.room) return;
    const on = !get().voice.screen;
    if (on && !get().voice.canStream) return toast("Tu n'as pas la permission de partager ton écran ici.", 'error');
    try {
      // Le navigateur propose de partager un écran entier, une fenêtre ou un onglet
      await this.room.localParticipant.setScreenShareEnabled(on, {
        audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include',
        resolution: { width: 1920, height: 1080, frameRate: 30 },
      });
      this.patch({ screen: on });
    } catch {
      if (on) toast("Le partage d'écran a été annulé ou refusé.");
      this.patch({ screen: false });
    }
    this.syncState();
    this.changed();
  }

  async toggleCamera() {
    if (!this.room) return;
    const on = !get().voice.camera;
    if (on && !get().voice.canStream) return toast("Tu n'as pas la permission d'activer la caméra ici.", 'error');
    try {
      await this.room.localParticipant.setCameraEnabled(on, { resolution: { width: 1280, height: 720, frameRate: 30 } });
      this.patch({ camera: on });
    } catch {
      toast("Impossible d'accéder à la caméra.", 'error');
      this.patch({ camera: false });
    }
    this.syncState();
    this.changed();
  }

  /** Changement de micro ou de haut-parleurs (en direct si on est en vocal). */
  async applyAudioSettings(next: AudioSettings) {
    const before = audioSettings();
    local.set('audio', next);
    if (!this.room) return;
    if (next.outputId !== before.outputId) await this.room.switchActiveDevice('audiooutput', next.outputId).catch(() => toast('Haut-parleurs indisponibles.', 'error'));
    const processingChanged = next.noiseSuppression !== before.noiseSuppression || next.echoCancellation !== before.echoCancellation || next.autoGain !== before.autoGain;
    if (next.inputId !== before.inputId && !processingChanged) {
      await this.room.switchActiveDevice('audioinput', next.inputId).catch(() => toast('Micro indisponible.', 'error'));
    } else if (processingChanged || next.inputId !== before.inputId) {
      // On relance le micro avec les nouveaux réglages
      const mic = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (mic?.track) {
        await this.room.localParticipant.unpublishTrack(mic.track);
        if (!get().voice.muted) {
          await this.room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: next.inputId, echoCancellation: next.echoCancellation, noiseSuppression: next.noiseSuppression, autoGainControl: next.autoGain,
          });
        }
      }
    }
  }

  /** Un modérateur a changé nos droits (rendu muet, exclusion…). */
  async applyPermissions(p: { channelId: number; speak: boolean; stream: boolean; serverMuted: boolean }) {
    if (get().voice.channelId !== p.channelId) return;
    this.patch({ canSpeak: p.speak, canStream: p.stream });
    if (!p.speak) {
      this.patch({ muted: true });
      await this.room?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      toast("Un modérateur t'a rendu muet.");
    } else {
      toast('Tu peux de nouveau parler.');
    }
    if (!p.stream) {
      if (get().voice.screen) await this.toggleScreen();
      if (get().voice.camera) await this.toggleCamera();
    }
    this.syncState();
  }
}

export const voice = new VoiceManager();
