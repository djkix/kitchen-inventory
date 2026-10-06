import { cn } from '../../lib/cn';
import { useHealthQuery } from '../../lib/queries';
import { versionState } from '../../lib/version';

/**
 * Version déployée, au bas des réglages seulement : c'est une information
 * d'administration, pas un élément des écrans du quotidien. Un écart avec la
 * version de l'interface signale une coque servie depuis un cache périmé, que
 * la réouverture de l'application corrige — mais le bandeau de mise à jour
 * (`UpdateBanner`), lui, reste visible partout et signale déjà cet écart.
 */
export function VersionBadge({ className }: { className?: string }) {
  const health = useHealthQuery();
  const { label, stale } = versionState(health.data?.version);

  return (
    <p className={cn('px-4 pb-2 pt-6 text-center text-[12px] text-faint', className)}>
      <span>Inventaire {label}</span>
      {stale && (
        <>
          {' · '}
          <span className="text-soon">interface {__APP_VERSION__}, fermez puis rouvrez l’application</span>
        </>
      )}
      {health.data && health.data.status !== 'ok' && !stale && (
        <>
          {' · '}
          <span className="text-soon">{health.data.checks.database === 'error' ? 'base injoignable' : 'service dégradé'}</span>
        </>
      )}
    </p>
  );
}
