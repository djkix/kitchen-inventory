import type { Difficulty, DishType, ModelRecipe, SuggestionIngredients, SuggestionRegion, VoiceHeard } from '@kitchen/shared';
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
  /** Modèle de CET appel, choisi par `GeminiService.call` dans la liste en direct de Google. */
  model?: string;
  /**
   * Recherche web réelle (outil `google_search`). Absente, le fournisseur
   * cherche : c'est la fonctionnalité demandée. À `false`, il compose toutes
   * les recettes lui-même — repli utile quand le fournisseur refuse la
   * recherche, qu'il facture séparément des jetons.
   */
  webSearch?: boolean;
  /**
   * Titres déjà présents au réservoir pour cette orientation (2026-10-19), que
   * le modèle ne doit pas reproposer. Les plus récents d'abord : le prompt les
   * borne (`KNOWN_TITLES_CAP`) et coupe la queue.
   */
  knownTitles?: readonly string[];
  /**
   * Ingrédients dictés à la main sur l'écran (2026-10-19, D1), **imposés** —
   * chaque recette doit tous les utiliser. Ils s'ajoutent aux graines tirées
   * du stock, ils ne les remplacent pas (D4). Le prompt lit `raw` (la saisie
   * telle quelle), jamais `terms`, réservé à la signature et au réservoir.
   */
  ingredients?: SuggestionIngredients;
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
 * Demande parlée (spécification du 2026-10-21) : la même demande, avec un
 * enregistrement à la place des ingrédients tapés. `ingredients` est exclu —
 * ce que la personne a dit est dans l'audio, pas dans un champ.
 *
 * L'audio ne traverse que cet objet : il n'est écrit nulle part, ni sur
 * disque, ni en base, ni dans le journal d'appels (D6).
 */
export type VoiceSuggestionRequest = Omit<SuggestionRequest, 'ingredients'> & {
  audio: Buffer;
  /** Type MIME tel que l'écran l'a enregistré (`audio/webm`, `audio/mp4`…), transmis au modèle. */
  mimeType: string;
};

/** Un appel parlé rend les recettes **et** la lecture que le modèle a faite de la phrase (D2, D4). */
export interface VoiceSuggestionOutput extends SuggestionOutput {
  heard: VoiceHeard;
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
