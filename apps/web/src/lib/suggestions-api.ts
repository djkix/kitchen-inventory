import type { Difficulty, KeepSuggestionInput, RecipeDto, SuggestionBatchDto, SuggestionDuration, SuggestionRegion } from '@kitchen/shared';
import { api } from './api';

/**
 * Orientation de recherche envoyée à `GET /suggestions` (section 12, B9) :
 * tous les champs sont facultatifs, une orientation vide équivaut à aucune
 * contrainte. Les filtres eux-mêmes sont branchés par la tâche 11.
 */
export interface SuggestionOrientation {
  region?: SuggestionRegion;
  maxMinutes?: SuggestionDuration;
  difficulty?: Difficulty;
  /** Redemande une fournée plutôt que de resservir la dernière en cache (tâche 12). */
  refresh?: boolean;
}

export const suggestionsApi = {
  /** Fournée de suggestions (EF-25, EF-26) : stock réel, cache et quotas sont décidés par le serveur. */
  list(orientation: SuggestionOrientation): Promise<SuggestionBatchDto> {
    return api.get<SuggestionBatchDto>('/suggestions', { query: { ...orientation } });
  },

  /**
   * Conserve une suggestion du lot en recette du foyer (EF-25, EF-26, B6) :
   * côté serveur, une page web est récupérée et réécrite par Gemini, ce qui
   * prend plusieurs secondes et consomme du quota — `clientOpId` rend un
   * rejeu (double appui, réseau lent) sans effet, la recette déjà créée est
   * alors rendue au lieu d'en recréer une.
   */
  keep(input: KeepSuggestionInput): Promise<RecipeDto> {
    return api.post<RecipeDto>('/suggestions/keep', input);
  },
};
