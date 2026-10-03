import type { CookRecipeInput, CookResult, LogCookedInput, RateLogInput, RecipeDto, RecipeFilters, RecipeLogDto } from '@kitchen/shared';
import { api } from './api';
import type { PendingRatingDto } from './types';

/** Écriture des préférences de filtres et de tri de la liste des recettes (section 12). */
export const recipesApi = {
  getFilters(): Promise<Partial<RecipeFilters>> {
    return api.get<Partial<RecipeFilters>>('/preferences/recipe-filters');
  },
  setFilters(filters: RecipeFilters): Promise<Partial<RecipeFilters>> {
    return api.put<Partial<RecipeFilters>>('/preferences/recipe-filters', filters);
  },
  /** Dernière réalisation non notée par l'utilisateur courant, ou `null` (bandeau de rappel, EF-28). */
  async getPendingRating(): Promise<PendingRatingDto | null> {
    const { pending } = await api.get<{ pending: PendingRatingDto | null }>('/recipe-logs/pending-rating');
    return pending;
  },
  /** Note (ou remplace sa propre note sur) une réalisation ; `409` hors fenêtre de sept jours (A25). */
  rateLog(logId: string, input: RateLogInput): Promise<RecipeLogDto> {
    return api.put<RecipeLogDto>(`/recipe-logs/${logId}/rating`, input);
  },
  /** « J'ai fait cette recette » (A26) : réalisation sans décrément de stock. */
  logCooked(recipeId: string, input: LogCookedInput): Promise<RecipeLogDto> {
    return api.post<RecipeLogDto>(`/recipes/${recipeId}/logs`, input);
  },
  /** Cuisson avec décompte du stock (EF-18) : le serveur fait l'unique mise à l'échelle (A14). */
  cookRecipe(recipeId: string, input: CookRecipeInput): Promise<CookResult> {
    return api.post<CookResult>(`/recipes/${recipeId}/cook`, input);
  },
  /** Supprime une réalisation ; `409` si elle a décrémenté le stock (A26). */
  removeLog(logId: string): Promise<void> {
    return api.delete<void>(`/recipe-logs/${logId}`);
  },
  /** Supprime une recette ; `409` si elle a déjà été réalisée (A20) : archiver prime sur supprimer. */
  removeRecipe(id: string): Promise<void> {
    return api.delete<void>(`/recipes/${id}`);
  },
  archiveRecipe(id: string): Promise<RecipeDto> {
    return api.post<RecipeDto>(`/recipes/${id}/archive`);
  },
  restoreRecipe(id: string): Promise<RecipeDto> {
    return api.post<RecipeDto>(`/recipes/${id}/restore`);
  },
};
