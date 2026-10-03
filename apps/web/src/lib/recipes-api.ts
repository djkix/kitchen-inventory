import type { RecipeFilters } from '@kitchen/shared';
import { api } from './api';

/** Écriture des préférences de filtres et de tri de la liste des recettes (section 12). */
export const recipesApi = {
  getFilters(): Promise<Partial<RecipeFilters>> {
    return api.get<Partial<RecipeFilters>>('/preferences/recipe-filters');
  },
  setFilters(filters: RecipeFilters): Promise<Partial<RecipeFilters>> {
    return api.put<Partial<RecipeFilters>>('/preferences/recipe-filters', filters);
  },
};
