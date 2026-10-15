import { describe, expect, it } from 'vitest';
import { suggestionIdentity } from './suggestion-identity.js';

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
