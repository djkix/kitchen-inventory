import { Button } from '../components/ui/button';
import { errorMessage } from '../lib/api';

/** Section 17 : base indisponible ou API injoignable → page de maintenance, pas d'écran vide. */
export function MaintenanceScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[24px] font-semibold">L’application est indisponible</h1>
      <p className="text-[15px] text-muted">{errorMessage(error, 'Le serveur ne répond pas.')} Le serveur démarre peut-être, ou une migration est en cours.</p>
      <Button variant="primary" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
