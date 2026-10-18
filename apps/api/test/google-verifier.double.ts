import { ApiError } from '../src/common/api-error.js';
import type { GoogleIdentity, GoogleTokenVerifier } from '../src/auth/google-token.verifier.js';

export interface FakeIdentity {
  email: string;
  name?: string | null;
  sub?: string;
  emailVerified?: boolean;
}

/**
 * Jeton de test : l'identité en clair. Aucun test ne touche le réseau
 * (section 19) — la vérification réelle (signature, audience, émetteur,
 * expiration) est couverte à part dans `google-token.verifier.spec.ts`.
 */
export function fakeGoogleCredential(identity: FakeIdentity): string {
  return JSON.stringify(identity);
}

export const fakeGoogleVerifier: GoogleTokenVerifier = {
  verify(credential: string): Promise<GoogleIdentity> {
    let parsed: FakeIdentity;
    try {
      parsed = JSON.parse(credential) as FakeIdentity;
    } catch {
      throw ApiError.unauthenticated('Connexion Google refusée');
    }
    if (!parsed?.email) throw ApiError.unauthenticated('Connexion Google refusée');
    return Promise.resolve({
      email: parsed.email.trim().toLowerCase(),
      emailVerified: parsed.emailVerified ?? true,
      sub: parsed.sub ?? `sub-${parsed.email}`,
      name: parsed.name ?? null,
    });
  },
};
