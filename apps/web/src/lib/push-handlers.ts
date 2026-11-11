import type { AiRequestKind } from '@kitchen/shared';

/**
 * Ce que le service worker fait d'une notification (conception du
 * 2026-11-02). À part, et non dans `sw.ts`, pour être testable sans worker :
 * le fichier du worker exécute `precacheAndRoute` dès son import et ne se
 * charge donc pas dans un test.
 */

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind?: AiRequestKind;
}

const FALLBACK: PushMessage = {
  title: 'Votre demande est prête',
  body: 'Touchez pour voir le résultat.',
  url: '/',
  tag: 'kitchen',
};

/** Lit le message, en se rabattant sur un texte générique s'il est illisible. */
export function readPushMessage(raw: string | null): PushMessage {
  if (!raw) return FALLBACK;
  try {
    const parsed = JSON.parse(raw) as Partial<PushMessage>;
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') return FALLBACK;
    return {
      title: parsed.title,
      body: parsed.body,
      url: typeof parsed.url === 'string' ? parsed.url : FALLBACK.url,
      // Le `tag` fait que deux annonces de la même demande se remplacent au
      // lieu de s'empiler dans le volet du téléphone.
      tag: typeof parsed.tag === 'string' ? parsed.tag : FALLBACK.tag,
    };
  } catch {
    return FALLBACK;
  }
}

export function notificationOptions(message: PushMessage): NotificationOptions {
  return {
    body: message.body,
    tag: message.tag,
    icon: '/icon.svg',
    badge: '/icon-maskable.svg',
    data: { url: message.url },
    lang: 'fr',
  };
}

/**
 * L'onglet à réveiller au clic : un onglet déjà ouvert sur l'application
 * plutôt qu'un nouveau, pour ne pas en empiler un par notification.
 */
export function clientToFocus<T extends { url: string }>(clients: readonly T[], origin: string): T | null {
  return clients.find((client) => client.url.startsWith(origin)) ?? null;
}

/**
 * Le chemin à ouvrir au clic, ramené à l'application. Seul notre serveur peut
 * signer une notification pour cet abonnement, mais une adresse venue du
 * réseau n'a pas à décider où va le téléphone : tout ce qui n'est pas un
 * chemin de l'application ramène à l'accueil (audit du 2026-11-11).
 */
export function sameOriginPath(raw: string | undefined, origin = self.location.origin): string {
  if (!raw) return '/';
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
