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
export function VersionBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const health = useHealthQuery();
  const { label, stale } = versionState(health.data?.version);
  const degraded = health.data !== undefined && health.data.status !== 'ok';

  /**
   * Forme compacte, dans l'en-tête de Réglages (demande de djkix,
   * 2026-10-22) : la version se lit d'un coup d'œil en haut à droite au lieu
   * d'attendre au bas d'un écran devenu pliable, où il fallait dérouler pour
   * l'atteindre. Les explications longues n'y tiennent pas — le bandeau de
   * mise à jour, lui, reste visible partout et dit déjà quoi faire.
   */
  if (compact) {
    return (
      <p className={cn('pr-1 text-right text-[12px] leading-tight text-faint', className)}>
        <span className="tnum">v{label}</span>
        {stale && <span className="block text-soon">mise à jour</span>}
        {degraded && !stale && <span className="block text-soon">dégradé</span>}
      </p>
    );
  }

  return (
    <p className={cn('px-4 pb-2 pt-6 text-center text-[12px] text-faint', className)}>
      <span>Inventaire {label}</span>
      {stale && (
        <>
          {' · '}
          <span className="text-soon">interface {__APP_VERSION__}, fermez puis rouvrez l’application</span>
        </>
      )}
      {degraded && !stale && (
        <>
          {' · '}
          <span className="text-soon">{health.data?.checks.database === 'error' ? 'base injoignable' : 'service dégradé'}</span>
        </>
      )}
    </p>
  );
}
