import type { PushPublicKeyDto } from '@kitchen/shared';
import { api } from './api';

/**
 * Abonnement de l'appareil aux notifications (conception du 2026-11-02,
 * amendée le 2026-11-02 : demande automatique sur un geste).
 *
 * Partagé par l'interrupteur de Réglages et par la première demande au modèle
 * de l'appareil, pour qu'il n'existe qu'un seul chemin d'abonnement.
 */

const ASKED_KEY = 'kitchen.pushAsked';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function publicKey(): Promise<string | null> {
  return api
    .get<PushPublicKeyDto>('/notifications/public-key')
    .then((dto) => dto.publicKey)
    .catch(() => null);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).catch(() => null);
}

/**
 * Demande l'autorisation si elle n'a jamais été demandée, puis abonne.
 *
 * **Toujours appelée depuis un geste de l'utilisateur** — l'interrupteur, ou
 * le bouton qui lance une demande au modèle : les navigateurs refusent, ou
 * déprécient fortement, une demande d'autorisation surgie sans action.
 *
 * Rend l'état atteint. Une seule tentative automatique par appareil : un refus
 * ne doit pas redemander à chaque photo. L'interrupteur de Réglages, lui,
 * passe outre ce garde-fou, puisqu'il est un geste explicite.
 */
export async function ensurePushSubscription(options: { auto?: boolean } = {}): Promise<'subscribed' | 'denied' | 'unavailable'> {
  if (!pushSupported()) return 'unavailable';
  if (options.auto && localStorage.getItem(ASKED_KEY) === '1') return 'unavailable';

  const key = await publicKey();
  if (!key) return 'unavailable';

  const existing = await currentSubscription();
  if (existing) {
    // Déjà abonné côté navigateur : on le réaffirme au serveur, qui a pu
    // perdre la ligne (base restaurée, compte recréé).
    await api.post('/notifications/subscription', existing.toJSON()).catch(() => undefined);
    return 'subscribed';
  }

  if (options.auto) markAsked();
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default' && (await Notification.requestPermission()) !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post('/notifications/subscription', subscription.toJSON());
  return 'subscribed';
}

export async function removePushSubscription(): Promise<void> {
  const existing = await currentSubscription();
  if (!existing) return;
  await api.delete('/notifications/subscription', { endpoint: existing.endpoint }).catch(() => undefined);
  await existing.unsubscribe();
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Stockage refusé : au pire, l'autorisation est redemandée une fois de plus.
  }
}
