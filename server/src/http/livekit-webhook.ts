// Événements envoyés par LiveKit (participant arrivé / parti) : source de vérité de la présence vocale.
import type { FastifyInstance } from 'fastify';
import { channelOfRoom, webhookReceiver } from '../services/livekit.js';
import { voiceWebhook } from '../services/bus.js';

export function registerLivekitWebhook(app: FastifyInstance) {
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.post('/api/livekit/webhook', async (req, reply) => {
    try {
      const event = await webhookReceiver.receive(String(req.body), req.headers.authorization);
      const channelId = event.room?.name ? channelOfRoom(event.room.name) : null;
      const userId = Number(event.participant?.identity);
      if (channelId && userId) {
        if (event.event === 'participant_joined') voiceWebhook(channelId, userId, true);
        if (event.event === 'participant_left') voiceWebhook(channelId, userId, false);
      }
      return { ok: true };
    } catch {
      return reply.code(401).send({ error: 'Signature invalide.' });
    }
  });
}
