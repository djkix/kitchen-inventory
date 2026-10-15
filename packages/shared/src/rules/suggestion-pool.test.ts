import { describe, expect, it } from 'vitest';
import { comparePoolEntries, type PoolEntryForSort } from './suggestion-pool.js';

const entry = (over: Partial<PoolEntryForSort>): PoolEntryForSort => ({
  verified: false,
  coverage: 0,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
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

  it('est un ordre total stable : comparer une entrée à elle-même rend zéro', () => {
    const e = entry({ verified: true, coverage: 0.5 });
    expect(comparePoolEntries(e, e)).toBe(0);
  });
});
