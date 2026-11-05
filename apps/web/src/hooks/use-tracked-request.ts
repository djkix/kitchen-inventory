import { useCallback, useRef } from 'react';
import { beginAiRequest, watchAiRequest } from '../lib/ai-request';
import { ensurePushSubscription } from '../lib/push-subscription';

/**
 * Encadre une demande au modèle pour qu'elle survive à l'écran (conception du
 * 2026-11-02) : un identifiant engendré avant de partir, la surveillance du
 * passage en arrière-plan pendant l'attente, et l'arrêt de la surveillance
 * dès que quelque chose est rendu.
 *
 * L'appelant reçoit l'identifiant et le passe à sa fonction d'API ; tout le
 * reste est ici — y compris la toute première demande d'autorisation de
 * l'appareil (amendement du 2026-11-02).
 *
 * Elle part d'ici et non de Réglages parce que c'est le seul endroit où elle
 * a du sens : on vient d'appuyer sur « Parler » ou de photographier un ticket,
 * l'attente commence, et le geste qui l'a déclenchée est exactement celui que
 * les navigateurs exigent pour accepter une demande d'autorisation. Une seule
 * tentative par appareil : un refus ne redemande jamais tout seul.
 */
export function useTrackedRequest(): <T>(run: (requestId: string) => Promise<T>) => Promise<T> {
  const stop = useRef<(() => void) | null>(null);

  return useCallback(async <T,>(run: (requestId: string) => Promise<T>): Promise<T> => {
    stop.current?.();
    const id = beginAiRequest();
    stop.current = watchAiRequest(id);
    // Sans `await` : l'autorisation ne doit pas retarder d'une milliseconde la
    // demande elle-même, et son issue ne change rien à ce qui suit.
    void ensurePushSubscription({ auto: true }).catch(() => undefined);
    try {
      return await run(id);
    } finally {
      stop.current?.();
      stop.current = null;
    }
  }, []);
}
