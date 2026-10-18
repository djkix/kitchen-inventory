import { OAuth2Client, type TokenPayload, type VerifyIdTokenOptions } from 'google-auth-library';
import { ApiError } from '../common/api-error.js';

export const GOOGLE_TOKEN_VERIFIER = Symbol('GOOGLE_TOKEN_VERIFIER');

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  sub: string;
  name: string | null;
}

export interface GoogleTokenVerifier {
  /** Lève `ApiError.unauthenticated` si le jeton n'est pas exploitable. */
  verify(credential: string): Promise<GoogleIdentity>;
}

/** Ce qu'on utilise d'`OAuth2Client` : réduit à ça pour que les tests le doublent. */
export interface IdTokenClient {
  verifyIdToken(options: VerifyIdTokenOptions): Promise<{ getPayload(): TokenPayload | undefined }>;
}

/**
 * Vérificateur réel. `google-auth-library` contrôle la signature RS256 contre
 * le JWKS tournant de Google, l'émetteur, l'expiration et **l'audience** : un
 * jeton signé par Google mais émis pour une autre application est rejeté parce
 * qu'on lui passe le `GOOGLE_CLIENT_ID` configuré (vigilance 5).
 */
export class GoogleIdTokenVerifier implements GoogleTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly client: IdTokenClient = new OAuth2Client(),
  ) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    if (!this.clientId) throw ApiError.unauthenticated('Connexion Google non configurée');
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: this.clientId });
      payload = ticket.getPayload();
    } catch {
      throw ApiError.unauthenticated('Connexion Google refusée');
    }
    if (!payload?.email || !payload.sub) throw ApiError.unauthenticated('Connexion Google refusée');
    return {
      email: payload.email.trim().toLowerCase(),
      emailVerified: payload.email_verified === true,
      sub: payload.sub,
      name: payload.name?.trim() || null,
    };
  }
}
