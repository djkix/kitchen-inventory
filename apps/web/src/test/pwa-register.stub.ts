/** Remplace `virtual:pwa-register/react` sous Vitest : aucun service worker en test. */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => undefined] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => undefined,
  };
}
