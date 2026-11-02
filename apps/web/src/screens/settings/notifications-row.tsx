import { useEffect, useState } from 'react';
import type { PushPublicKeyDto } from '@kitchen/shared';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';

/**
 * « Me prévenir quand une réponse est prête » (conception du 2026-11-02, D8).
 *
 * Dans Réglages, et non au moment où l'on quitte l'écran : la page y est en
 * train d'être gelée par le système, et une demande d'autorisation surgie à ce
 * moment-là serait refusée par réflexe. L'interrupteur vaut pour l'appareil où
 * l'on est, et le dit.
 */
export function NotificationsRow() {
  const toast = useToast();
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

  useEffect(() => {
    void api
      .get<PushPublicKeyDto>('/notifications/public-key')
      .then((dto) => setPublicKey(dto.publicKey))
      .catch(() => setPublicKey(null));
    if (!supported) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => setSubscribed(existing !== null))
      .catch(() => undefined);
  }, [supported]);

  const reason = !supported
    ? 'Cet appareil ne sait pas afficher de notifications. Sur iPhone, il faut d’abord installer l’application sur l’écran d’accueil.'
    : publicKey === null
      ? 'Les notifications ne sont pas configurées sur ce serveur.'
      : null;

  const toggle = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (subscribed) {
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          await api.delete('/notifications/subscription', { endpoint: existing.endpoint });
          await existing.unsubscribe();
        }
        setSubscribed(false);
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') {
        toast.show({ message: 'Les notifications sont refusées pour cette application. Vous pouvez les réautoriser dans les réglages du téléphone.', tone: 'danger' });
        return;
      }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey! });
      await api.post('/notifications/subscription', subscription.toJSON());
      setSubscribed(true);
      toast.show({ message: 'Cet appareil sera prévenu quand une réponse est prête', tone: 'success', durationMs: 2500 });
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
              : 'Posez votre téléphone pendant une demande : la notification vous dira que le résultat est là. Réglage propre à cet appareil.')}
        </span>
      </label>
      <input
        id="notifications"
        type="checkbox"
        role="switch"
        disabled={busy || reason !== null || publicKey === undefined}
        checked={subscribed}
        onChange={() => void toggle()}
        className="size-6 shrink-0 accent-accent disabled:opacity-60"
      />
    </div>
  );
}
