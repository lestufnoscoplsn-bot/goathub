// Configuration : tout vient des variables d'environnement (voir .env.example), vérifiées au démarrage.
import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).default('0').transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  DATA_DIR: z.string().default('./data'),
  // Clé maîtresse : chiffrement des données sensibles. Ne jamais la changer après la mise en service.
  APP_SECRET: z.string().min(32, 'APP_SECRET doit faire au moins 32 caractères'),
  // Adresse publique du site (ex : https://goathub.exemple.fr) : liens d'invitation et contrôle anti-CSRF
  PUBLIC_URL: z.string().url(),
  EXTRA_ORIGINS: z.string().default(''),
  LIVEKIT_URL: z.string().url(),            // adresse utilisée par le serveur (API)
  LIVEKIT_PUBLIC_URL: z.string().url(),     // adresse utilisée par les navigateurs (ws:// ou wss://)
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  TRUST_PROXY: bool,                         // derrière un proxy (Caddy, Render…) : lire X-Forwarded-*
  FORCE_HTTPS: bool,
  SIGNUP_CODE: z.string().default(''),       // si rempli : code obligatoire pour s'inscrire
  ADMIN_EMAILS: z.string().default(''),      // emails des administrateurs du site (signalements globaux)
  ALERT_WEBHOOK: z.string().default(''),     // alertes de sécurité (Discord, Slack, ntfy…)
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(25),
  SIGNUPS_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(5), // par adresse IP (contre les robots)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')} : ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
export const allowedOrigins = new Set([
  new URL(config.PUBLIC_URL).origin,
  ...config.EXTRA_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
]);
export const adminEmails = new Set(config.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
export const isProd = config.NODE_ENV === 'production';
