import { useEffect } from 'react';
import { notificationPayload } from '@kitchen/shared';
import { useToast } from '../components/ui/toast';
import { recoverAiRequests } from '../lib/ai-request';

/**
 * Au retour sur l'application (conception du 2026-11-02) : le résultat des
 * demandes qu'on n'a pas vues aboutir est réclamé au serveur, et nommé.
 *
 * La notification suffit quand on la touche ; ceci couvre l'autre chemin —
 * rouvrir l'application sans y avoir touché, ou n'avoir jamais autorisé les
 * notifications. Le résultat lui-même est déjà en base : l'écran concerné le
 * relira, ce message dit seulement qu'il y a quelque chose à voir.
 */
export function useAiRequestRecovery(): void {
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const check = () => {
      void recoverAiRequests().then((finished) => {
        if (!alive) return;
        for (const request of finished) {
          const done = request.state === 'DONE';
          const { title } = notificationPayload({
            id: request.id,
            kind: request.kind,
            outcome: done ? 'DONE' : 'ABANDONED',
            reason: request.error ?? undefined,
          });
          toast.show({ message: done ? title : (request.error ?? title), tone: done ? 'success' : 'danger', durationMs: 6000 });
        }
      });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);
}
