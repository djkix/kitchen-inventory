import { describe, expect, it } from 'vitest';
import { effectiveRating } from './effective-rating.js';

describe('effectiveRating', () => {
  it('préfère la note directe quand elle existe', () => {
    expect(effectiveRating(5, 2.5)).toEqual({ value: 5, source: 'direct' });
  });

  it('se rabat sur la moyenne des réalisations', () => {
    expect(effectiveRating(null, 2.5)).toEqual({ value: 2.5, source: 'cooked' });
  });

  it("rend null quand rien n'a été noté : pas d'étoiles vides", () => {
    expect(effectiveRating(null, null)).toEqual({ value: null, source: null });
  });

  it('retirer la note directe fait réapparaître la moyenne', () => {
    expect(effectiveRating(null, 4)).toEqual({ value: 4, source: 'cooked' });
  });
});
