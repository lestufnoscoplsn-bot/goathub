// Journal de sécurité (fichier JSON lignes) + alertes vers un webhook pour les événements graves.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const file = path.join(config.DATA_DIR, 'security.log');
const SERIOUS = new Set(['account_locked', 'ip_blocked', 'rate_limited', 'csrf_blocked', '2fa_failures', 'unusual_login', 'flood', 'report_created']);
const lastAlert = new Map<string, number>();
let queue = Promise.resolve();

export function securityLog(event: string, details: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n';
  queue = queue.then(async () => {
    try {
      await mkdir(config.DATA_DIR, { recursive: true, mode: 0o700 });
      const info = await stat(file).catch(() => null);
      if (info && info.size > 5_000_000) await rename(file, file + '.1');
      await appendFile(file, line, { mode: 0o600 });
    } catch (err) {
      console.error('Journal de sécurité indisponible', err);
    }
  });
  if (SERIOUS.has(event)) {
    console.warn(`[sécurité] ${event}`, details);
    alert(event, details);
  }
}

function alert(event: string, details: Record<string, unknown>): void {
  if (!config.ALERT_WEBHOOK) return;
  const now = Date.now();
  if (now - (lastAlert.get(event) ?? 0) < 60_000) return; // au plus une alerte par minute et par type
  lastAlert.set(event, now);
  const text = `⚠️ GoatHub – ${event} ${JSON.stringify(details)}`.slice(0, 1800);
  fetch(config.ALERT_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
