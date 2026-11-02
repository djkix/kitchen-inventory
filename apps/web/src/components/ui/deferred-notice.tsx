import { deferredDelayLabel } from '@kitchen/shared';
import { deferredRetryAt } from '../../lib/ai-request';
import { pushSupported } from '../../lib/push-subscription';

/**
 * Demande gardée par le serveur, en attendant que Gemini se libère
 * (conception du 2026-11-02, formulation arrêtée le 2026-11-02 avec djkix).
 *
 * Ce n'est pas un échec, et l'écran ne doit pas le présenter comme tel : la
 * demande repartira seule. Le délai est dit en durée et non en heure — « dans
 * environ 20 minutes » se comprend d'un coup d'œil.
 *
 * La promesse de notification est conditionnelle, parce qu'une promesse
 * fausse est pire que pas de promesse : sans autorisation, rien n'arrivera, et
 * l'écran doit le dire plutôt que de laisser attendre.
 */
export function DeferredNotice({ error, what }: { error: unknown; what: 'recettes' | 'ticket' }) {
  const retryAt = deferredRetryAt(error);
  const delai = retryAt ? deferredDelayLabel({ now: new Date(), retryAt }) : null;
  const prevenu = pushSupported() && Notification.permission === 'granted';

  return (
    <div role="status" className="mx-4 my-6 rounded-card bg-raised px-4 py-4 text-center">
      <p className="text-[15px] font-medium">En attente de Gemini</p>
      <p className="mt-1 text-[14px] text-muted">
        Service saturé. {what === 'ticket' ? 'Votre ticket' : 'Votre demande'} repartira {delai ? <>seule dans environ <span className="font-medium text-ink">{delai}</span></> : 'seule dès la reprise'}. Vous
        pouvez fermer l’application.
      </p>
      <p className="mt-2 text-[14px] text-muted">
        {prevenu
          ? `Vous recevrez une notification dès que ${what === 'ticket' ? 'votre ticket sera lu' : 'vos recettes seront prêtes'}.`
          : 'Activez les notifications dans Réglages pour être prévenu dès que c’est prêt.'}
      </p>
    </div>
  );
}
