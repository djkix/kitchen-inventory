import type { RateLogInput, RecipeFilters, RecipeLogDto } from '@kitchen/shared';
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
  getPendingRating(): Promise<PendingRatingDto | null> {
    return api.get<PendingRatingDto | null>('/recipe-logs/pending-rating');
  },
  /** Note (ou remplace sa propre note sur) une réalisation ; `409` hors fenêtre de sept jours (A25). */
  rateLog(logId: string, input: RateLogInput): Promise<RecipeLogDto> {
    return api.put<RecipeLogDto>(`/recipe-logs/${logId}/rating`, input);
  },
};
