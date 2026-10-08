/**
 * Mémorisation du dernier volet ouvert du module recettes (tâche 9), même
 * idiome que `scan-session.ts` : stockage injectable pour les tests, repli
 * silencieux sur Suggestions si le stockage est indisponible (navigation
 * privée) ou lève une exception.
 */
export type RecipeTab = 'suggestions' | 'bibliotheque';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const RECIPE_TAB_KEY = 'kitchen.recipes.lastTab';

const PATH_BY_TAB: Record<RecipeTab, string> = {
  suggestions: '/recettes',
  bibliotheque: '/recettes/bibliotheque',
};

function safeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readRecipeTab(storage?: StorageLike): RecipeTab {
  const store = safeStorage(storage);
  if (!store) return 'suggestions';
  try {
    return store.getItem(RECIPE_TAB_KEY) === 'bibliotheque' ? 'bibliotheque' : 'suggestions';
  } catch {
    return 'suggestions';
  }
}

export function writeRecipeTab(tab: RecipeTab, storage?: StorageLike): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(RECIPE_TAB_KEY, tab);
  } catch {
    /* stockage plein ou interdit (navigation privée) : le choix ne survit pas au rechargement */
  }
}

/** Route du volet, pour le `NavLink`/`Link` qui y mène. */
export function pathForRecipeTab(tab: RecipeTab): string {
  return PATH_BY_TAB[tab];
}

/** Volet correspondant à une route du module recettes (`/recettes` ou `/recettes/bibliotheque`). */
export function recipeTabForPath(pathname: string): RecipeTab {
  return pathname === PATH_BY_TAB.bibliotheque ? 'bibliotheque' : 'suggestions';
}

/** Chemin vers le dernier volet consulté, pour l'onglet Recettes de la barre du bas. */
export function recipesTabPath(storage?: StorageLike): string {
  return pathForRecipeTab(readRecipeTab(storage));
}
