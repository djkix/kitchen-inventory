import { describe, expect, it } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { ApiError } from '../common/api-error.js';
import { GoogleIdTokenVerifier, type IdTokenClient } from './google-token.verifier.js';

/**
 * Doublure de `OAuth2Client` : aucun test ne touche le réseau (section 19).
 * Elle reproduit ce que fait la bibliothèque — rejeter un jeton dont l'audience
 * n'est pas celle qu'on lui demande de vérifier.
 */
function clientFor(payload: Partial<TokenPayload> & { aud: string }): IdTokenClient {
  return {
    verifyIdToken: async ({ idToken, audience }) => {
      if (idToken !== 'jeton-signe') throw new Error('signature invalide');
      if (payload.aud !== audience) throw new Error(`Wrong recipient, payload audience != requiredAudience`);
      return { getPayload: () => payload as TokenPayload };
    },
  };
}

const PAYLOAD = { aud: 'bon-client-id', sub: '1234', email: 'Proprietaire@Example.org', email_verified: true, name: 'djkix' };

describe('GoogleIdTokenVerifier', () => {
  it('rend l’identité, adresse normalisée en minuscules', async () => {
    const identity = await new GoogleIdTokenVerifier('bon-client-id', clientFor(PAYLOAD)).verify('jeton-signe');
    expect(identity).toEqual({ email: 'proprietaire@example.org', emailVerified: true, sub: '1234', name: 'djkix' });
  });

  it('refuse un jeton émis pour une autre application (vigilance 5)', async () => {
    const verifier = new GoogleIdTokenVerifier('bon-client-id', clientFor({ ...PAYLOAD, aud: 'autre-application' }));
    await expect(verifier.verify('jeton-signe')).rejects.toMatchObject({ status: 401 });
  });

  it('refuse un jeton dont la signature ne passe pas', async () => {
    const verifier = new GoogleIdTokenVerifier('bon-client-id', clientFor(PAYLOAD));
    await expect(verifier.verify('jeton-bricole')).rejects.toBeInstanceOf(ApiError);
  });

  it('rapporte `email_verified` faux sans le masquer — le refus est pris plus haut', async () => {
    const verifier = new GoogleIdTokenVerifier('bon-client-id', clientFor({ ...PAYLOAD, email_verified: false }));
    expect((await verifier.verify('jeton-signe')).emailVerified).toBe(false);
  });

  it('refuse quand aucun Client ID n’est configuré, sans même appeler la bibliothèque', async () => {
    // Doublure permissive : elle accepterait tout. Seule la garde peut refuser.
    let appels = 0;
    const permissif: IdTokenClient = {
      verifyIdToken: async () => {
        appels += 1;
        return { getPayload: () => PAYLOAD as TokenPayload };
      },
    };
    await expect(new GoogleIdTokenVerifier('', permissif).verify('jeton-signe')).rejects.toMatchObject({ status: 401 });
    expect(appels).toBe(0);
  });

  it('refuse un jeton sans adresse e-mail', async () => {
    const verifier = new GoogleIdTokenVerifier('bon-client-id', clientFor({ aud: 'bon-client-id', sub: '1234' }));
    await expect(verifier.verify('jeton-signe')).rejects.toMatchObject({ status: 401 });
  });
});
