import { normalizeProductName } from './duplicates.js';

/**
 * Rapprochement d'un libellé d'ingrédient de recette avec le stock (EF-26) :
 * « sûr » quand le nom normalisé correspond exactement à un produit du stock,
 * « probable » quand seul un score de similarité trigramme (pg_trgm, calculé
 * en amont) dépasse le seuil, « absent » sinon. Une égalité de nom l'emporte
 * toujours sur un meilleur score de similarité sur un autre produit : un
 * rapprochement exact est une certitude, un score trigramme ne l'est pas.
 */
export type MatchState = 'sure' | 'probable' | 'absent';

/**
 * Score de similarité (pg_trgm) minimal pour retenir un candidat. C'est un
 * plancher inclusif : un candidat exactement à ce score est retenu
 * (`probable`), en dessous il ne l'est pas (`absent`).
 */
export const MATCH_SIMILARITY_FLOOR = 0.4;

export interface MatchCandidate {
  productId: string;
  name: string;
  /** Score de similarité trigramme entre 0 et 1, déjà calculé par l'appelant. */
  similarity: number;
}

export interface IngredientMatch {
  state: MatchState;
  productId: string | null;
  productName: string | null;
}

const ABSENT_MATCH: IngredientMatch = { state: 'absent', productId: null, productName: null };

/**
 * Classe le meilleur rapprochement possible entre un libellé d'ingrédient et
 * une liste de produits candidats. Un libellé vide (ou blanc) rend `absent`
 * sans consulter les candidats : sinon un libellé vide se rapprocherait du
 * premier produit venu dès que son nom normalisé est lui aussi vide.
 */
export function classifyMatch(label: string, candidates: readonly MatchCandidate[]): IngredientMatch {
  const normalizedLabel = normalizeProductName(label);
  if (normalizedLabel === '') return ABSENT_MATCH;

  const exact = candidates.find((candidate) => normalizeProductName(candidate.name) === normalizedLabel);
  if (exact) return { state: 'sure', productId: exact.productId, productName: exact.name };

  let best: MatchCandidate | null = null;
  for (const candidate of candidates) {
    // Comparaison stricte (`>`) : en cas d'égalité de score, on garde le premier
    // candidat rencontré plutôt qu'un dernier arbitraire — choix délibéré, pas un hasard.
    if (candidate.similarity >= MATCH_SIMILARITY_FLOOR && (!best || candidate.similarity > best.similarity)) {
      best = candidate;
    }
  }
  if (!best) return ABSENT_MATCH;

  return { state: 'probable', productId: best.productId, productName: best.name };
}
