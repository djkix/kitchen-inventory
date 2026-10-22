import { describe, expect, it } from 'vitest';
import { csvCell } from './export.controller.js';

/** Injection de formule dans l'export CSV (EF-16, revue de sécurité du 2026-10-22). */
describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("https://ailleurs.example","clic")', `"'=HYPERLINK(""https://ailleurs.example"",""clic"")"`],
    ['+33 6 00 00 00 00', "'+33 6 00 00 00 00"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', `"'\r=1+1"`],
  ])('neutralise %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('laisse le reste tel quel', () => {
    expect(csvCell('Lait demi-écrémé')).toBe('Lait demi-écrémé');
    expect(csvCell('a = b')).toBe('a = b');
    expect(csvCell(-1.5)).toBe('-1.5');
    expect(csvCell(true)).toBe('oui');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Pâtes; 500 g')).toBe('"Pâtes; 500 g"');
  });
});
