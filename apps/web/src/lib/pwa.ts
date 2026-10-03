import { useRegisterSW } from 'virtual:pwa-register/react';

/** Intervalle entre deux vérifications de mise à jour, application ouverte. */
const UPDATE_CHECK_MS = 30 * 60_000;
/** Délai avant le rechargement de secours, si aucun service worker n'attendait. */
const RELOAD_FALLBACK_MS = 1500;

export interface AppUpdate {
  /** Vrai quand une nouvelle version est téléchargée et attend d'être activée. */
  needRefresh: boolean;
  /** Active la nouvelle version et recharge l'application. */
  reload: () => void;
}

/**
 * Suit les mises à jour du service worker. Une application installée ne
 * vérifie d'elle-même qu'au lancement : on relance la vérification toutes les
 * trente minutes et à chaque retour au premier plan, sinon une version déployée
 * en journée n'arrive sur le téléphone qu'au prochain démarrage complet.
 */
export function useAppUpdate(): AppUpdate {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => undefined);
      window.setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  return {
    needRefresh,
    reload: () => {
      void updateServiceWorker(true);
      // Sans service worker en attente, `updateServiceWorker` ne recharge rien :
      // ce filet couvre le cas d'une coque périmée repérée par l'écart de version.
      window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
    },
  };
}
