// Petits sons générés (aucun fichier à télécharger).
let ctx: AudioContext | null = null;
function tone(freq: number, duration: number, delay = 0, volume = 0.06) {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch { /* son indisponible */ }
}
export const sounds = {
  message: () => tone(880, 0.12),
  mention: () => { tone(740, 0.1); tone(990, 0.14, 0.11); },
  join: () => { tone(520, 0.1); tone(780, 0.14, 0.09); },
  leave: () => { tone(780, 0.1); tone(520, 0.14, 0.09); },
  mute: () => tone(400, 0.08),
  unmute: () => tone(600, 0.08),
  ring: () => { tone(660, 0.18, 0, 0.08); tone(880, 0.22, 0.2, 0.08); },
};
