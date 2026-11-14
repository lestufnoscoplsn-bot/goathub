// Enregistrement des actions temps réel : validation des données (zod), gestion des erreurs, réponse { ok, data }.
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { AppError } from '../services/errors.js';

export interface Ctx {
  socket: Socket;
  userId: number;
  sessionId: number;
  ip: string;
}

type Handler<S extends z.ZodTypeAny> = (ctx: Ctx, data: z.infer<S>) => Promise<unknown> | unknown;
const handlers = new Map<string, { schema: z.ZodTypeAny; fn: Handler<any> }>();

/** Déclare une action. Les données reçues sont TOUJOURS vérifiées par le schéma avant d'être utilisées. */
export function action<S extends z.ZodTypeAny>(name: string, schema: S, fn: Handler<S>) {
  handlers.set(name, { schema, fn });
}

export function bindHandlers(socket: Socket, ctx: Ctx, allow: () => boolean) {
  for (const [name, { schema, fn }] of handlers) {
    socket.on(name, async (raw: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
      if (!allow()) return reply({ ok: false, error: "Trop d'actions : ralentis." });
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) return reply({ ok: false, error: 'Données invalides.' });
      try {
        const data = await fn(ctx, parsed.data);
        reply({ ok: true, data: data ?? null });
      } catch (err) {
        if (err instanceof AppError) return reply({ ok: false, error: err.message, code: err.code });
        console.error(`Erreur dans ${name}`, err);
        reply({ ok: false, error: 'Erreur du serveur.' });
      }
    });
  }
}

// Petits schémas réutilisés
export const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const txt = (max: number, min = 0) => z.string().max(max).transform((s) => s.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, '').trim()).refine((s) => s.length >= min, { message: 'trop court' });
