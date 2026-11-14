// Petit relais entre la partie HTTP et le temps réel (ex : prévenir un utilisateur d'une connexion suspecte).
type Emit = (userId: number, event: string, payload: unknown) => void;
let emitToUser: Emit = () => {};
export const setUserEmitter = (fn: Emit) => { emitToUser = fn; };
export const notifyUser: Emit = (userId, event, payload) => emitToUser(userId, event, payload);

type VoiceHook = (channelId: number, userId: number, joined: boolean) => void;
let voiceHook: VoiceHook = () => {};
export const setVoiceHook = (fn: VoiceHook) => { voiceHook = fn; };
export const voiceWebhook: VoiceHook = (c, u, j) => voiceHook(c, u, j);
