import { hash, verify, Algorithm } from '@node-rs/argon2';

/** Section 10 : mots de passe hachés en Argon2id. Paramètres OWASP (19 Mio, 2 itérations). */
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
