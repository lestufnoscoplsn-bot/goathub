// Double authentification : codes TOTP (RFC 6238), compatibles avec Google Authenticator, Aegis, 2FAS…
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((chunk) => ALPHABET[parseInt(chunk, 2)]).join('');
}

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const c of secret) bits += ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[19] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Renvoie le pas de temps du code s'il est valide et pas déjà utilisé (anti-rejeu), sinon null. */
export function verifyTotp(secret: string, code: string, lastUsedStep: number): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now - 1, now, now + 1]) {
    const expected = codeAt(secret, step);
    if (step > lastUsedStep && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

export const totpUri = (secret: string, account: string) =>
  `otpauth://totp/GoatHub:${encodeURIComponent(account)}?secret=${secret}&issuer=GoatHub&digits=6&period=30`;

export const qrDataUrl = (text: string) => QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' });

export const newRecoveryCodes = () =>
  Array.from({ length: 10 }, () => `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}`);
