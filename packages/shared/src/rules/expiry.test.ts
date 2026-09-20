import { describe, expect, it } from 'vitest';
import { computeEffectiveExpiry, daysUntil, estimateExpiry, excludedFromRecipes, expiryStatus } from './expiry.js';

const d = (iso: string) => new Date(`${iso}T12:00:00`);
const today = d('2026-09-20');

describe('computeEffectiveExpiry', () => {
  it('renvoie null sans date ni ouverture', () => {
    expect(computeEffectiveExpiry({ expiryDate: null, openedAt: null, afterOpeningDays: 4 })).toBeNull();
  });
  it('renvoie la DLC quand le produit est fermé', () => {
    expect(computeEffectiveExpiry({ expiryDate: d('2026-10-01'), openedAt: null, afterOpeningDays: 4 })).toEqual(d('2026-10-01'));
  });
  it('prend la plus proche entre la DLC et ouverture + durée après ouverture', () => {
    expect(
      computeEffectiveExpiry({ expiryDate: d('2026-10-01'), openedAt: d('2026-09-20'), afterOpeningDays: 4 }),
    ).toEqual(d('2026-09-24'));
    expect(
      computeEffectiveExpiry({ expiryDate: d('2026-09-22'), openedAt: d('2026-09-20'), afterOpeningDays: 4 }),
    ).toEqual(d('2026-09-22'));
  });
  it('utilise ouverture + durée quand il n’y a pas de DLC', () => {
    expect(computeEffectiveExpiry({ expiryDate: null, openedAt: d('2026-09-20'), afterOpeningDays: 2 })).toEqual(d('2026-09-22'));
  });
  it('garde la DLC si la catégorie n’a pas de durée après ouverture', () => {
    expect(computeEffectiveExpiry({ expiryDate: d('2026-10-01'), openedAt: d('2026-09-20'), afterOpeningDays: null })).toEqual(d('2026-10-01'));
  });
});

describe('estimateExpiry', () => {
  it('ajoute la durée de conservation de la catégorie', () => {
    expect(estimateExpiry(today, 7)).toEqual(d('2026-09-27'));
  });
});

describe('daysUntil', () => {
  it('compte en jours civils', () => {
    expect(daysUntil(d('2026-09-27'), today)).toBe(7);
    expect(daysUntil(d('2026-09-19'), today)).toBe(-1);
    expect(daysUntil(new Date('2026-09-21T00:30:00'), new Date('2026-09-20T23:30:00'))).toBe(1);
  });
});

describe('expiryStatus', () => {
  const alertDays = 7;
  it('aucune date → none', () => {
    expect(expiryStatus({ effectiveExpiry: null, dateType: null, dateEstimated: false }, today, alertDays)).toBe('none');
  });
  it('DLC dépassée → expired_use_by', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-19'), dateType: 'USE_BY', dateEstimated: false }, today, alertDays)).toBe('expired_use_by');
  });
  it('DDM dépassée → expired_best_before', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-19'), dateType: 'BEST_BEFORE', dateEstimated: false }, today, alertDays)).toBe('expired_best_before');
  });
  it('date estimée dépassée → soon, jamais expired', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-10'), dateType: 'USE_BY', dateEstimated: true }, today, alertDays)).toBe('soon');
  });
  it('le jour même n’est pas dépassé', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-20'), dateType: 'USE_BY', dateEstimated: false }, today, alertDays)).toBe('soon');
  });
  it('sous le seuil → soon, au-delà → ok', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-27'), dateType: 'USE_BY', dateEstimated: false }, today, alertDays)).toBe('soon');
    expect(expiryStatus({ effectiveExpiry: d('2026-09-28'), dateType: 'USE_BY', dateEstimated: false }, today, alertDays)).toBe('ok');
  });
  it('sans type de date, une date dépassée est traitée comme une DLC', () => {
    expect(expiryStatus({ effectiveExpiry: d('2026-09-01'), dateType: null, dateEstimated: false }, today, alertDays)).toBe('expired_use_by');
  });
});

describe('excludedFromRecipes', () => {
  it('exclut seulement la DLC dépassée', () => {
    expect(excludedFromRecipes('expired_use_by')).toBe(true);
    expect(excludedFromRecipes('expired_best_before')).toBe(false);
    expect(excludedFromRecipes('soon')).toBe(false);
    expect(excludedFromRecipes('none')).toBe(false);
  });
});
