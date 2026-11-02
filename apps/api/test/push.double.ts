import { createECDH, randomBytes } from 'node:crypto';
import { generateVAPIDKeys } from 'web-push';

/**
 * Clés de test pour Web Push, **engendrées à chaque exécution** et jamais
 * écrites dans le dépôt.
 *
 * Une paire codée en dur, fût-elle tirée d'une documentation publique, est
 * indiscernable d'un vrai secret pour un détecteur comme gitleaks — et
 * l'habitude d'en voir dans les tests est exactement celle qui fait passer un
 * vrai secret un jour.
 */
export const VAPID = generateVAPIDKeys();

/**
 * Abonnement plausible : une vraie paire de clés P-256 et un secret
 * d'authentification de seize octets, les deux formes qu'exige le chiffrement
 * de `web-push`. Des valeurs inventées feraient échouer l'envoi avant même
 * d'atteindre ce que le test veut vérifier.
 */
export function fakeSubscription(endpoint: string): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
