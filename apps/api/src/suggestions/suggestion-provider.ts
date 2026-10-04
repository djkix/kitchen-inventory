import type { Difficulty, ModelRecipe, SuggestionRegion } from '@kitchen/shared';
import { ProviderError } from '../recognition/providers/recognition-provider.js';

/** Orientation facultative de la recherche (section 12, EF-25, B9) et nombre de recettes voulues. */
export interface SuggestionRequest {
  seeds: readonly string[];
  region?: SuggestionRegion;
  maxMinutes?: number;
  difficulty?: Difficulty;
  count: number;
}

/**
 * Une tentative facturée auprès du fournisseur. Le fournisseur peut en faire
 * deux (une reprise après une réponse illisible) : chacune consomme des jetons
 * et doit apparaître dans le journal d'appels, sans quoi la première échappe au
 * quota journalier comme au plafond mensuel.
 */
export interface SuggestionAttempt {
  /** Réponse brute du fournisseur, conservée dans le journal d'appels pour rejouer les échecs. */
  raw: unknown;
  costCents: number | null;
  latencyMs: number;
}

export interface SuggestionOutput {
  recipes: ModelRecipe[];
  /** Toutes les tentatives facturées, dans l'ordre : au moins une, deux en cas de reprise. */
  attempts: SuggestionAttempt[];
  model: string;
}

/**
 * Échec du fournisseur alors qu'au moins une tentative a déjà été facturée :
 * porte ces tentatives pour que l'appelant les journalise malgré l'échec.
 */
export class SuggestionProviderError extends ProviderError {
  constructor(
    message: string,
    readonly attempts: SuggestionAttempt[],
    cause?: unknown,
  ) {
    super(message, cause);
  }
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
