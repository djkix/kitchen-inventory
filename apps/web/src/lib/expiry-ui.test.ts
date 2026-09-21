import { describe, expect, it } from 'vitest';
import { daysLabel, daysSentence, expiryGroupOf, expiryLook, formatDate, todayIso } from './expiry-ui';

describe('expiry-ui', () => {
  it('associe rouge à la DLC dépassée et orange à la DDM dépassée (section 15)', () => {
    expect(expiryLook('expired_use_by').rail).toBe('bg-danger');
    expect(expiryLook('expired_best_before').rail).toBe('bg-warn');
    expect(expiryLook('soon').rail).toBe('bg-soon');
    expect(expiryLook('ok').rail).toBe('bg-transparent');
  });

  it('formate le compte à rebours', () => {
    expect(daysLabel(3)).toBe('J-3');
    expect(daysLabel(0)).toBe('Aujourd’hui');
    expect(daysLabel(-2)).toBe('J+2');
    expect(daysLabel(null)).toBe('—');
  });

  it('écrit une phrase complète, avec la mention estimée', () => {
    expect(daysSentence(1, false)).toBe('périme demain');
    expect(daysSentence(-3, true)).toBe('Estimé : dépassée depuis 3 jours');
    expect(daysSentence(null, false)).toBe('Aucune date');
  });

  it('formate une date civile sans décalage de fuseau', () => {
    expect(formatDate('2026-10-01')).toMatch(/1 oct\.? 2026/);
    expect(formatDate(null)).toBe('—');
  });

  it('regroupe les statuts en quatre sections', () => {
    expect(expiryGroupOf('expired_use_by')).toBe('expired');
    expect(expiryGroupOf('expired_best_before')).toBe('expired');
    expect(expiryGroupOf('soon')).toBe('soon');
    expect(expiryGroupOf('ok')).toBe('later');
    expect(expiryGroupOf('none')).toBe('none');
  });

  it('produit la date du jour au format AAAA-MM-JJ', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
