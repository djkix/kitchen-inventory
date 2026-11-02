import { useCallback, useRef } from 'react';
import { beginAiRequest, watchAiRequest } from '../lib/ai-request';

/**
 * Encadre une demande au modèle pour qu'elle survive à l'écran (conception du
 * 2026-11-02) : un identifiant engendré avant de partir, la surveillance du
 * passage en arrière-plan pendant l'attente, et l'arrêt de la surveillance
 * dès que quelque chose est rendu.
 *
 * L'appelant reçoit l'identifiant et le passe à sa fonction d'API ; tout le
 * reste est ici.
 */
export function useTrackedRequest(): <T>(run: (requestId: string) => Promise<T>) => Promise<T> {
  const stop = useRef<(() => void) | null>(null);

  return useCallback(async <T,>(run: (requestId: string) => Promise<T>): Promise<T> => {
    stop.current?.();
    const id = beginAiRequest();
    stop.current = watchAiRequest(id);
    try {
      return await run(id);
    } finally {
      stop.current?.();
      stop.current = null;
    }
  }, []);
}
