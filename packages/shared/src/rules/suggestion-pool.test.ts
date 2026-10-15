import { describe, expect, it } from 'vitest';
import { comparePoolEntries, type PoolEntryForSort } from './suggestion-pool.js';

const entry = (over: Partial<PoolEntryForSort>): PoolEntryForSort => ({
  verified: false,
  coverage: 0,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  title: 'Recette',
  identity: 'aaaaaaaa',
  ...over,
});

describe('comparePoolEntries (EF-26, D7)', () => {
  it('place une recette web vérifiée avant une composition, même moins couverte', () => {
    const web = entry({ verified: true, coverage: 0.2 });
    const compo = entry({ verified: false, coverage: 1 });
    expect(comparePoolEntries(web, compo)).toBeLessThan(0);
    expect(comparePoolEntries(compo, web)).toBeGreaterThan(0);
  });

  it('à statut égal, la meilleure couverture passe devant', () => {
    expect(comparePoolEntries(entry({ coverage: 0.8 }), entry({ coverage: 0.4 }))).toBeLessThan(0);
  });

  it('à couverture égale, la plus récemment découverte passe devant', () => {
    const vieille = entry({ firstSeenAt: '2026-01-01T00:00:00.000Z' });
    const neuve = entry({ firstSeenAt: '2026-06-01T00:00:00.000Z' });
    expect(comparePoolEntries(neuve, vieille)).toBeLessThan(0);
  });

  it('départage deux écritures ISO du même instant comme une égalité', () => {
    const avecZ = entry({ firstSeenAt: '2026-06-01T10:00:00.000Z' });
    const avecOffset = entry({ firstSeenAt: '2026-06-01T12:00:00+02:00' });
    expect(comparePoolEntries(avecZ, avecOffset)).toBe(0);
  });

  it('reste un ordre total quand une date est illisible', () => {
    const cassee = entry({ firstSeenAt: 'pas une date' });
    const bonne = entry({ firstSeenAt: '2026-06-01T10:00:00.000Z' });
    expect(comparePoolEntries(cassee, bonne)).toBe(0);
    expect(comparePoolEntries(bonne, cassee)).toBe(0);
  });

  it('départage par le titre deux entrées autrement équivalentes', () => {
    expect(comparePoolEntries(entry({ title: 'Blanquette' }), entry({ title: 'Tarte' }))).toBeLessThan(0);
    expect(comparePoolEntries(entry({ title: 'Tarte' }), entry({ title: 'Blanquette' }))).toBeGreaterThan(0);
  });

  it('départage par l’identité deux recettes de même titre : l’ordre est total', () => {
    // Deux recettes web peuvent porter le même titre sous des URL différentes :
    // sans ce dernier critère, leur rang relatif dépendrait de l'ordre de
    // lecture en base, donc varierait d'un affichage à l'autre.
    const a = entry({ title: 'Tarte aux pommes', identity: '0000000a' });
    const b = entry({ title: 'Tarte aux pommes', identity: '0000000b' });
    expect(comparePoolEntries(a, b)).toBeLessThan(0);
    expect(comparePoolEntries(b, a)).toBeGreaterThan(0);
    expect(comparePoolEntries(a, a)).toBe(0);
  });

  it('est transitif sur les trois critères', () => {
    const a = entry({ verified: true, coverage: 0.9 });
    const b = entry({ verified: true, coverage: 0.5 });
    const c = entry({ verified: false, coverage: 1 });
    expect(comparePoolEntries(a, b)).toBeLessThan(0);
    expect(comparePoolEntries(b, c)).toBeLessThan(0);
    expect(comparePoolEntries(a, c)).toBeLessThan(0);
  });

  it('est un ordre total stable : comparer une entrée à elle-même rend zéro', () => {
    const e = entry({ verified: true, coverage: 0.5 });
    expect(comparePoolEntries(e, e)).toBe(0);
  });
});
