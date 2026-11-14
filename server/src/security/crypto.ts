// Chiffrement des données sensibles (AES-256-GCM) et empreintes (HMAC-SHA256), dérivés de APP_SECRET.
import crypto from 'node:crypto';
import { config } from '../config.js';

const master = crypto.createHash('sha256').update(config.APP_SECRET).digest();
const derive = (label: string) => crypto.createHmac('sha256', master).update(`goathub/${label}`).digest();
const encKey = derive('encryption');
const hmacKey = derive('fingerprint');

export function encrypt(data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(data: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}

export const encryptText = (text: string) => 'v1:' + encrypt(Buffer.from(text, 'utf8')).toString('base64');
export function decryptText(value: string | null): string {
  if (!value) return '';
  if (!value.startsWith('v1:')) throw new Error('Format chiffré inconnu');
  return decrypt(Buffer.from(value.slice(3), 'base64')).toString('utf8');
}

/** Empreinte à sens unique (pour retrouver une donnée chiffrée, ex : l'email à la connexion). */
export const fingerprint = (text: string) => 'h:' + crypto.createHmac('sha256', hmacKey).update(text).digest('hex');
export const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const randomId = () => crypto.randomBytes(16).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
