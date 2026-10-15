import { COVERAGE_GROUP_LABELS_FR, DIFFICULTY_LABELS_FR, DISH_TYPE_LABELS_FR, type SuggestionDto } from '@kitchen/shared';
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
 * Mention de provenance : le nom du site pour une recette dont la page a été
 * lue, l'aveu explicite qu'il s'agit d'une invention du modèle sinon (B6,
 * décision D5 du 2026-10-15).
 *
 * La mention dit désormais ce que la recette EST, pas seulement d'où elle
 * vient. « Proposée par l'IA » laissait croire à une recette trouvée quelque
 * part et simplement relayée ; une composition n'existe nulle part ailleurs
 * que dans la réponse du modèle, et le propriétaire a demandé que rien ne
 * puisse se faire passer pour une recette qui existe.
 *
 * Le nom du site tient à `verified`, pas à la seule provenance : une recette
 * `web` dont la page n'a pas été lue n'a pas le droit de s'abriter derrière un
 * nom de domaine. Dans le réservoir, une telle ligne est jetée à l'ingestion —
 * cette garde couvre le cas où elle arriverait par un autre chemin.
 *
 * Jamais d'étapes ici, quelle que soit la provenance — les deux doivent se
 * ressembler avant conservation (B7, décision du 2026-10-04).
 */
export function provenanceLabel(suggestion: SuggestionDto): string {
  if (suggestion.provenance === 'web' && suggestion.verified && suggestion.sourceUrl) return siteName(suggestion.sourceUrl);
  return 'Composée par l’IA, non vérifiée';
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
  return `${suggestion.title}, ${DISH_TYPE_LABELS_FR[suggestion.dishType]}, ${COVERAGE_GROUP_LABELS_FR[suggestion.group]} à ${Math.round(suggestion.coverage * 100)} %`;
}

export function SuggestionCard({ suggestion }: SuggestionCardProps) {
  const time = formatMinutes(suggestion.totalMinutes);
  return (
    <article className="flex flex-col gap-2 rounded-card bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 line-clamp-2 text-[16px] font-medium leading-tight">{suggestion.title}</h3>
        <span className={cn('tnum shrink-0 rounded-md px-1.5 py-0.5 text-[13px] font-semibold', GROUP_LOOK[suggestion.group])}>
          {COVERAGE_GROUP_LABELS_FR[suggestion.group]} · {Math.round(suggestion.coverage * 100)} %
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
        <span>{DISH_TYPE_LABELS_FR[suggestion.dishType]}</span>
        <span aria-hidden>·</span>
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
