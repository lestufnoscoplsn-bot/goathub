// Mots de passe : Argon2id (recommandation OWASP) + règles de solidité.
import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DUMMY = await hash('goathub-dummy-password', OPTIONS);

export const hashPassword = (password: string) => hash(password, OPTIONS);

/** Vérifie un mot de passe. Sans compte, on vérifie quand même une empreinte factice (même temps de réponse). */
export async function checkPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  try {
    return await verify(stored ?? DUMMY, password.slice(0, 200)) && !!stored;
  } catch {
    return false;
  }
}

const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'azerty123', 'azertyuiop', 'password1', 'motdepasse1', 'qwerty123',
  'soleil123', 'bonjour123', 'doudou123', 'loulou123', 'chocolat1', 'marseille13', 'football1', 'abc12345',
  'password123', 'admin123', 'iloveyou1', 'goathub1', 'goathub123',
]);

export function passwordProblem(password: string, username = '', email = ''): string | null {
  if (password.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (password.length > 200) return 'Le mot de passe est trop long.';
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || new Set(lower).size < 4) return 'Ce mot de passe est trop facile à deviner.';
  for (const part of [username.toLowerCase(), email.split('@')[0].toLowerCase()]) {
    if (part.length >= 3 && lower.includes(part)) return 'Le mot de passe ne doit pas contenir ton pseudo ni ton email.';
  }
  return null;
}
