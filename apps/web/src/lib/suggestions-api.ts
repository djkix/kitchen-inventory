import type { Difficulty, DishType, KeepSuggestionInput, RecipeDto, SuggestionBatchDto, SuggestionDuration, SuggestionRegion } from '@kitchen/shared';
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
  /**
   * Type de plat demandé au modèle (`prompt.ts` : « Ne propose que des
   * recettes de type X »). Orientation serveur à part entière, comme les
   * trois autres champs ci-dessous (revue finale du 2026-10-11) : la
   * fournée qui en résulte est mono-type, un filtre d'écran local sur un
   * seul type déjà présent n'aurait donc plus d'objet.
   */
  dishType?: DishType;
  /**
   * Relance explicite : demande une nouvelle recherche au modèle au lieu de
   * servir le réservoir (D6, D11, 2026-10-15). Seule sortie du verrou de 24
   * heures posé sur une orientation déjà demandée.
   */
  refresh?: boolean;
}

export const suggestionsApi = {
  /** Suggestions (EF-25, EF-26) : réservoir, appel au modèle et quotas sont décidés par le serveur, la couverture est recalculée contre le stock du moment. */
  list(orientation: SuggestionOrientation): Promise<SuggestionBatchDto> {
    return api.get<SuggestionBatchDto>('/suggestions', { query: { ...orientation } });
  },

  /**
   * Conserve une suggestion en recette du foyer (EF-25, EF-26, B6). Le site
   * n'est **jamais** recontacté : sa page a été lue une seule fois, à l'entrée
   * au réservoir, et son contenu y est gardé (D10, 2026-10-15). Côté serveur,
   * une recette web est réécrite par Gemini à partir de ce contenu — plusieurs
   * secondes et du quota ; une composition ne coûte rien. `clientOpId` rend un
   * rejeu (double appui, réseau lent) sans effet, la recette déjà créée est
   * alors rendue au lieu d'en recréer une.
   */
  keep(input: KeepSuggestionInput): Promise<RecipeDto> {
    return api.post<RecipeDto>('/suggestions/keep', input);
  },
};
