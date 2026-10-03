import { Button } from '../ui/button';
import { useHealthQuery } from '../../lib/queries';
import { useAppUpdate } from '../../lib/pwa';
import { versionState } from '../../lib/version';

interface UpdateBannerViewProps {
  visible: boolean;
  /** Version proposée, affichée quand le serveur l'a déjà annoncée. */
  version: string | null;
  onReload: () => void;
}

/**
 * Bandeau de mise à jour, au-dessus de la barre de navigation. Il reste sous
 * l'écran de scan, qui s'affiche par-dessus : une session de scan ne doit pas
 * être interrompue par une proposition de rechargement.
 */
export function UpdateBannerView({ visible, version, onReload }: UpdateBannerViewProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      className="safe-bottom fixed inset-x-0 bottom-[var(--spacing-nav)] z-30 mx-auto max-w-lg px-3 pb-2"
    >
      <div className="flex items-center gap-3 rounded-card border border-line bg-raised px-4 py-3 shadow-lg">
        <p className="flex-1 text-[14px] leading-snug">
          Nouvelle version disponible{version ? ` (${version})` : ''}.
        </p>
        <Button variant="primary" size="sm" onClick={onReload}>
          Recharger
        </Button>
      </div>
    </div>
  );
}

export function UpdateBanner() {
  const update = useAppUpdate();
  const health = useHealthQuery();
  const { label, stale } = versionState(health.data?.version);

  // Deux signaux complémentaires : le service worker a téléchargé une nouvelle
  // coque, ou le serveur annonce une version plus récente que celle chargée,
  // cas d'un cache qui n'a pas encore été rafraîchi.
  const visible = update.needRefresh || stale;

  return <UpdateBannerView visible={visible} version={stale ? label : null} onReload={update.reload} />;
}
