import { createHash, randomBytes } from 'node:crypto';

/** Jeton de session : 32 octets aléatoires ; seul le SHA-256 est stocké. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Jeton de service reconnaissable : préfixe `kit_` puis 48 hexadécimaux. */
export function newServiceToken(): string {
  return `kit_${randomBytes(24).toString('hex')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
