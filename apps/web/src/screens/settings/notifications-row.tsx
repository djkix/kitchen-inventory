import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { currentSubscription, ensurePushSubscription, publicKey, pushSupported, removePushSubscription } from '../../lib/push-subscription';

/**
 * « Me prévenir quand une réponse est prête » (conception du 2026-11-02, D8,
 * amendée le 2026-11-02).
 *
 * L'autorisation n'est plus demandée **que** d'ici : la première demande au
 * modèle faite sur l'appareil la demande d'elle-même, au moment où l'attente
 * commence. Cet interrupteur reste la façon de revenir sur ce choix, de voir
 * où l'on en est, et de comprendre pourquoi rien n'arrive — un appareil qui
 * ne sait pas faire, un serveur sans clés, une autorisation refusée au
 * téléphone, qu'une application web ne peut pas redemander elle-même.
 */
export function NotificationsRow() {
  const toast = useToast();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const supported = pushSupported();
  const denied = supported && Notification.permission === 'denied';

  useEffect(() => {
    void publicKey().then(setKey);
    void currentSubscription().then((existing) => setSubscribed(existing !== null));
  }, []);

  const reason = !supported
    ? 'Cet appareil ne sait pas afficher de notifications. Sur iPhone, il faut d’abord installer l’application sur l’écran d’accueil.'
    : key === null
      ? 'Les notifications ne sont pas configurées sur ce serveur.'
      : denied && !subscribed
        ? 'Les notifications sont refusées pour cette application. Réautorisez-les dans les réglages du téléphone : une page web ne peut pas le redemander elle-même.'
        : null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        await removePushSubscription();
        setSubscribed(false);
        return;
      }
      const state = await ensurePushSubscription();
      setSubscribed(state === 'subscribed');
      if (state === 'subscribed') toast.show({ message: 'Cet appareil sera prévenu quand une réponse est prête', tone: 'success', durationMs: 2500 });
      else if (state === 'denied') toast.show({ message: 'Les notifications sont refusées pour cette application. Réautorisez-les dans les réglages du téléphone.', tone: 'danger' });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'L’abonnement n’a pas pu être enregistré'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
      <label htmlFor="notifications" className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">Me prévenir quand une réponse est prête</span>
        <span className="text-[13px] text-muted">
          {reason ??
            (subscribed
              ? 'Cet appareil reçoit une notification quand une demande au modèle aboutit alors que vous avez quitté l’écran.'
              : 'L’autorisation vous sera demandée à votre prochaine demande de recettes ou de lecture de ticket. Réglage propre à cet appareil.')}
        </span>
      </label>
      <input
        id="notifications"
        type="checkbox"
        role="switch"
        disabled={busy || reason !== null || key === undefined}
        checked={subscribed}
        onChange={() => void toggle()}
        className="size-6 shrink-0 accent-accent disabled:opacity-60"
      />
    </div>
  );
}
