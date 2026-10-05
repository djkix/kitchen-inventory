import { describe, expect, it } from 'vitest';
import { expiryShortcutDate, toCivilIsoDate } from './expiry-shortcuts.js';

describe('expiryShortcutDate', () => {
  it('+3 j compte en jours civils', () => {
    expect(expiryShortcutDate('threeDays', new Date(2026, 9, 5, 14, 0))).toBe('2026-10-08');
  });

  it('+1 sem compte sept jours civils', () => {
    expect(expiryShortcutDate('oneWeek', new Date(2026, 9, 5, 14, 0))).toBe('2026-10-12');
  });

  it('+1 mois avance le mois civil', () => {
    expect(expiryShortcutDate('oneMonth', new Date(2026, 9, 5, 14, 0))).toBe('2026-11-05');
  });

  it('+1 mois depuis le 31 janvier tombe le dernier jour de février, pas en mars (année non bissextile)', () => {
    expect(expiryShortcutDate('oneMonth', new Date(2026, 0, 31, 9, 0))).toBe('2026-02-28');
  });

  it('+1 mois depuis le 31 janvier d’une année bissextile tombe le 29 février', () => {
    expect(expiryShortcutDate('oneMonth', new Date(2028, 0, 31, 9, 0))).toBe('2028-02-29');
  });

  it('+1 mois depuis le 30 mars tombe le 30 avril', () => {
    expect(expiryShortcutDate('oneMonth', new Date(2026, 2, 30, 9, 0))).toBe('2026-04-30');
  });

  it(
    'reste sur le jour civil local même tard le soir, quand l’heure UTC est encore celle de la veille ' +
      '(un calcul naïf en UTC se tromperait de jour)',
    () => {
      // 1er janvier 2026, 23 h 30 locales : si l'heure locale a 1 h d'avance sur
      // UTC (comme Paris en hiver), l'instant UTC correspondant est encore le
      // 1er janvier 22 h 30 — mais s'il en avait deux (comme Paris en été), un
      // calcul fondé sur `toISOString()` daterait déjà du lendemain en UTC
      // alors que l'utilisateur, lui, est toujours le 1er janvier localement.
      const localLateEvening = new Date(2026, 0, 1, 23, 30);
      expect(expiryShortcutDate('threeDays', localLateEvening)).toBe('2026-01-04');

      // Juste après minuit local : un calcul qui lirait la date via
      // `toISOString().slice(0, 10)` (UTC) resterait sur la veille tant que
      // l'horloge UTC n'a pas, elle aussi, franchi minuit.
      const justAfterLocalMidnight = new Date(2026, 0, 2, 0, 30);
      expect(toCivilIsoDate(justAfterLocalMidnight)).toBe('2026-01-02');
      expect(expiryShortcutDate('threeDays', justAfterLocalMidnight)).toBe('2026-01-05');
    },
  );
});

describe('toCivilIsoDate', () => {
  it('pad les mois et jours à un chiffre', () => {
    expect(toCivilIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
