import type { Difficulty, DishType, ModelRecipe, SuggestionRegion } from '@kitchen/shared';
import { ProviderError } from '../recognition/providers/recognition-provider.js';

/** Orientation facultative de la recherche (section 12, EF-25, B9) et nombre de recettes voulues. */
export interface SuggestionRequest {
  seeds: readonly string[];
  region?: SuggestionRegion;
  maxMinutes?: number;
  difficulty?: Difficulty;
  /** Type de plat demandé ; sert au bouton de relance quand le filtre d'écran ne laisse rien. */
  dishType?: DishType;
  count: number;
  /**
   * Modèle choisi pour CET appel, résolu par le service depuis les réglages
   * (base, sinon environnement). Absent, le fournisseur applique son défaut.
   * Il ne peut pas être figé à la construction : le fournisseur est un
   * singleton Nest, et un réglage changé à l'écran n'aurait alors d'effet
   * qu'au redémarrage du conteneur.
   */
  model?: string;
  /**
   * Recherche web réelle (outil `google_search`). Absente, le fournisseur
   * cherche : c'est la fonctionnalité demandée. À `false`, il compose toutes
   * les recettes lui-même — repli utile quand le fournisseur refuse la
   * recherche, qu'il facture séparément des jetons.
   */
  webSearch?: boolean;
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
 * Récupérateur de page et réécrivain Gemini : jetons d'injection, construits
 * par `SuggestionsModule` parce qu'ils ont besoin du client HTTP injectable
 * (rejoué par fixtures dans les tests, section 19).
 *
 * Le fournisseur de suggestions n'a pas d'interface : Gemini en est la seule
 * implémentation, et la section 12 l'a retenu comme seul fournisseur possible —
 * la recherche web est le service rendu, pas un détail d'implémentation.
 * `GeminiSuggestionProvider` est donc injecté par sa classe.
 */
export const RECIPE_PAGE_FETCHER = Symbol('RECIPE_PAGE_FETCHER');
export const RECIPE_REWRITER = Symbol('RECIPE_REWRITER');
