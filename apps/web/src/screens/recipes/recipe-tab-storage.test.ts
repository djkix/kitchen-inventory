import { describe, expect, it } from 'vitest';
import { pathForRecipeTab, readRecipeTab, recipeTabForPath, recipesTabPath, writeRecipeTab, type StorageLike } from './recipe-tab-storage';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
};

describe('recipe-tab-storage', () => {
  it('retombe sur Suggestions tant que rien n’est mémorisé', () => {
    expect(readRecipeTab(memoryStorage())).toBe('suggestions');
  });

  it('mémorise et relit le volet Mes recettes', () => {
    const storage = memoryStorage();
    writeRecipeTab('bibliotheque', storage);
    expect(readRecipeTab(storage)).toBe('bibliotheque');
    expect(recipesTabPath(storage)).toBe('/recettes/bibliotheque');
  });

  it('survit à un stockage qui lève une exception (navigation privée) : repli sur Suggestions', () => {
    expect(() => writeRecipeTab('bibliotheque', broken)).not.toThrow();
    expect(readRecipeTab(broken)).toBe('suggestions');
    expect(recipesTabPath(broken)).toBe('/recettes');
  });

  it('associe chaque route du module recettes à son volet', () => {
    expect(recipeTabForPath('/recettes')).toBe('suggestions');
    expect(recipeTabForPath('/recettes/bibliotheque')).toBe('bibliotheque');
    expect(pathForRecipeTab('suggestions')).toBe('/recettes');
    expect(pathForRecipeTab('bibliotheque')).toBe('/recettes/bibliotheque');
  });
});
