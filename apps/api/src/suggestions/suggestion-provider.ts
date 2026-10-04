import type { Difficulty, ModelRecipe, SuggestionRegion } from '@kitchen/shared';

/** Orientation facultative de la recherche (section 12, EF-25, B9) et nombre de recettes voulues. */
export interface SuggestionRequest {
  seeds: readonly string[];
  region?: SuggestionRegion;
  maxMinutes?: number;
  difficulty?: Difficulty;
  count: number;
}

export interface SuggestionOutput {
  recipes: ModelRecipe[];
  /** Réponse brute du fournisseur, conservée dans le journal d'appels pour rejouer les échecs. */
  raw: unknown;
  costCents: number | null;
  model: string;
}

/**
 * Section 5, niveau 4 (même principe que `RecognitionProvider`) : le fournisseur
 * de suggestions est derrière une interface pour pouvoir changer de modèle sans
 * toucher au reste du module recettes.
 */
export interface SuggestionProvider {
  readonly name: string;
  readonly enabled: boolean;
  suggest(req: SuggestionRequest): Promise<SuggestionOutput>;
}

export const SUGGESTION_PROVIDER = Symbol('SUGGESTION_PROVIDER');

/** Récupérateur de page (tâche 9) et réécrivain Gemini (tâche 9) : jetons d'injection, construits par `SuggestionsModule`. */
export const RECIPE_PAGE_FETCHER = Symbol('RECIPE_PAGE_FETCHER');
export const RECIPE_REWRITER = Symbol('RECIPE_REWRITER');
