import { describe, expect, it } from 'vitest';
import { suggestionIdentities, suggestionIdentity } from './suggestion-identity.js';

const recette = { title: 'Pâtes à la tomate', sourceUrl: 'https://exemple.test/pates' };

describe('suggestionIdentity (EF-26)', () => {
  it('rend le même identifiant pour la même recette, d’une fournée à l’autre', () => {
    expect(suggestionIdentity(recette)).toBe(suggestionIdentity({ ...recette }));
  });

  it('ne dépend ni du rang ni de la casse ni des espaces autour', () => {
    expect(suggestionIdentity({ title: '  pâtes à la tomate ', sourceUrl: ' HTTPS://EXEMPLE.TEST/pates ' })).toBe(suggestionIdentity(recette));
  });

  it('distingue deux recettes de même titre venues de sites différents', () => {
    expect(suggestionIdentity({ ...recette, sourceUrl: 'https://autre.test/pates' })).not.toBe(suggestionIdentity(recette));
  });

  it('distingue deux compositions de titres différents, toutes deux sans URL', () => {
    expect(suggestionIdentity({ title: 'Soupe', sourceUrl: null })).not.toBe(suggestionIdentity({ title: 'Gratin', sourceUrl: null }));
  });

  it('ne confond pas un titre qui absorberait l’URL d’une autre', () => {
    expect(suggestionIdentity({ title: 'Soupehttps://x.test', sourceUrl: null })).not.toBe(suggestionIdentity({ title: 'Soupe', sourceUrl: 'https://x.test' }));
  });

  it('rend un identifiant court et lisible dans une URL', () => {
    expect(suggestionIdentity(recette)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('suggestionIdentities (EF-26)', () => {
  const rizAi = { title: 'Riz sauté', sourceUrl: null };
  const soupe = { title: 'Soupe', sourceUrl: null };

  it('ne fait pas dériver les identités de recettes à titres distincts (clientOpId stable)', () => {
    const batch = [soupe, { title: 'Gratin', sourceUrl: null }];
    expect(suggestionIdentities(batch)).toEqual([suggestionIdentity(soupe), suggestionIdentity({ title: 'Gratin', sourceUrl: null })]);
  });

  it('distingue deux compositions IA de même titre dans la même fournée', () => {
    const batch = [rizAi, { ...rizAi }];
    const [first, second] = suggestionIdentities(batch);
    expect(first).toBe(suggestionIdentity(rizAi));
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('est déterministe : la même fournée rend les mêmes identités à chaque appel', () => {
    const batch = [rizAi, { ...rizAi }, soupe, { ...rizAi }];
    expect(suggestionIdentities(batch)).toEqual(suggestionIdentities([...batch]));
  });

  it('ne fait pas hériter une identité du doublon à une recette écartée par la validation', () => {
    // La fournée brute avait trois « Riz sauté » ; la validation en écarte une
    // (celle du milieu, par exemple pour un champ invalide) avant d'appeler
    // `suggestionIdentities` : seules les recettes survivantes comptent pour le rang.
    const survivants = [rizAi, { ...rizAi }];
    const [, secondSurvivant] = suggestionIdentities(survivants);
    // Le deuxième survivant est le troisième de la fournée brute, mais ne doit
    // porter que le suffixe de rang 2 (deuxième occurrence parmi les survivants),
    // jamais celui qu'aurait porté l'entrée écartée.
    expect(secondSurvivant).toBe(suggestionIdentities([rizAi, { ...rizAi }])[1]);
  });
});
