/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientToFocus, notificationOptions, readPushMessage, sameOriginPath } from './lib/push-handlers';

declare const self: ServiceWorkerGlobalScope;

/**
 * Service worker écrit à la main (conception du 2026-11-02, D10). Recevoir un
 * `push` l'imposait : `generateSW` ne sait engendrer que la mise en cache.
 *
 * La coque est mise en cache exactement comme avant — mêmes fichiers, même
 * repli de navigation, l'API et les médias toujours hors cache — et la mise à
 * jour reste **proposée** par bandeau, jamais appliquée d'autorité :
 * `skipWaiting` n'est appelé que sur le message que `virtual:pwa-register`
 * envoie quand on touche « Recharger ». Une session de scan en cours ne doit
 * pas être interrompue par une version déployée entre-temps.
 */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const message = readPushMessage(event.data?.text() ?? null);
  event.waitUntil(self.registration.showNotification(message.title, notificationOptions(message)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginPath((event.notification.data as { url?: string } | undefined)?.url);
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = clientToFocus(clients, self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
