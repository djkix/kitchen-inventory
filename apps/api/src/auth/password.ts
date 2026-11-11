import { randomBytes } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * CONSERVÉ bien que la connexion par mot de passe ait disparu (D5) : la porte
 * de secours (D6) hache ici son mot de passe à usage unique.
 */
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

/**
 * Hachage factice, engendré une fois, contre lequel on vérifie quand il n'y a
 * rien à vérifier. Sans lui, un refus immédiat (aucune fenêtre de secours
 * ouverte) et un refus après Argon2id (fenêtre ouverte, mot de passe faux) se
 * distinguent au chronomètre : la porte de secours dirait à qui la pousse
 * qu'elle vient d'être ouverte, et pour quelle adresse (audit du 2026-11-11).
 */
let decoy: Promise<string> | null = null;

export async function verifyAgainstDecoy(password: string): Promise<void> {
  decoy ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(await decoy, password);
}
