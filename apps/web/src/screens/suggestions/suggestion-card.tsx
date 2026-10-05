import { COVERAGE_GROUP_LABELS_FR, DIFFICULTY_LABELS_FR, type SuggestionDto } from '@kitchen/shared';
import { cn } from '../../lib/cn';
import { formatMinutes } from '../../lib/quantity-ui';

interface SuggestionCardProps {
  suggestion: SuggestionDto;
}

const GROUP_LOOK: Record<SuggestionDto['group'], string> = {
  ready: 'bg-accent-deep text-accent',
  almost: 'bg-soon-deep text-soon',
  excluded: 'bg-raised text-faint',
};

/** Nom du site depuis l'URL source, sans le protocole ni le chemin — jamais le lien entier (B10). */
function siteName(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return sourceUrl;
  }
}

/**
 * Mention de provenance : le nom du site pour une recette trouvée sur le web,
 * « proposée par l'IA » pour une composition du modèle (B6). Jamais d'étapes
 * ici, quelle que soit la provenance — les deux doivent se ressembler avant
 * conservation (B7, décision du 2026-10-04).
 */
export function provenanceLabel(suggestion: SuggestionDto): string {
  if (suggestion.provenance === 'web' && suggestion.sourceUrl) return siteName(suggestion.sourceUrl);
  return 'Proposée par l’IA';
}

/** Carte d'une suggestion (section 12, EF-25, EF-26) : même facture que `RecipeCard`, sans péremption ni étapes. */
/**
 * Nom accessible du bouton qui enveloppe la carte (même défaut que
 * `RecipeCard`, EF-23) : le rôle `article` ne contribue pas au nom calculé
 * d'un ancêtre interactif (Chromium), qu'il s'agisse d'un lien ou, ici, d'un
 * bouton. Le titre seul identifierait la suggestion, mais pas si elle est
 * cuisinable maintenant : on y ajoute l'état de couverture, même information
 * que le badge coloré, en mots.
 */
export function suggestionAccessibleName(suggestion: SuggestionDto): string {
  return `${suggestion.title}, ${COVERAGE_GROUP_LABELS_FR[suggestion.group]} à ${Math.round(suggestion.coverage * 100)} %`;
}

export function SuggestionCard({ suggestion }: SuggestionCardProps) {
  const time = formatMinutes(suggestion.totalMinutes);
  return (
    <article className="flex flex-col gap-2 rounded-card bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-medium leading-tight">{suggestion.title}</h3>
        <span className={cn('tnum shrink-0 rounded-md px-1.5 py-0.5 text-[13px] font-semibold', GROUP_LOOK[suggestion.group])}>
          {COVERAGE_GROUP_LABELS_FR[suggestion.group]} · {Math.round(suggestion.coverage * 100)} %
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
        <span>{suggestion.origin}</span>
        <span aria-hidden>·</span>
        {time && <span className="tnum">{time}</span>}
        {time && <span aria-hidden>·</span>}
        <span>{DIFFICULTY_LABELS_FR[suggestion.difficulty]}</span>
      </p>

      <p className="truncate text-[13px] text-muted">{provenanceLabel(suggestion)}</p>

      {suggestion.missingLabels.length > 0 && (
        <p className="truncate text-[13px] text-faint">Manque : {suggestion.missingLabels.join(', ')}</p>
      )}
    </article>
  );
}
