import { describe, expect, it } from 'vitest';
import { inLibrary, unfavoriteLeavesLibrary, type LibraryMembership } from './recipe-library.js';

const SUGGESTION: LibraryMembership = { source: 'GENERATED', favorite: false, timesCooked: 0 };

describe('appartenance à « Mes recettes » (D1)', () => {
  it('garde ce qu’on a saisi soi-même, étoilé ou réalisé', () => {
    expect(inLibrary({ ...SUGGESTION, source: 'HOUSEHOLD' })).toBe(true);
    expect(inLibrary({ ...SUGGESTION, favorite: true })).toBe(true);
    expect(inLibrary({ ...SUGGESTION, timesCooked: 2 })).toBe(true);
  });

  it('laisse au réservoir une suggestion ni étoilée ni réalisée', () => {
    expect(inLibrary(SUGGESTION)).toBe(false);
  });

  it('avertit seulement quand le retrait de l’étoile fait vraiment sortir la recette', () => {
    // Une suggestion étoilée sans réalisation : elle repart au réservoir.
    expect(unfavoriteLeavesLibrary({ ...SUGGESTION, favorite: true })).toBe(true);
    // Déjà réalisée, ou saisie au foyer : elle reste, rien à annoncer.
    expect(unfavoriteLeavesLibrary({ ...SUGGESTION, favorite: true, timesCooked: 1 })).toBe(false);
    expect(unfavoriteLeavesLibrary({ ...SUGGESTION, favorite: true, source: 'HOUSEHOLD' })).toBe(false);
    // Pas étoilée : il n'y a pas d'étoile à retirer.
    expect(unfavoriteLeavesLibrary(SUGGESTION)).toBe(false);
  });
});
