import { describe, expect, it } from 'vitest';
import { nextPacificMidnight, pacificDay, resumeAt } from './gemini-time.js';

/** Le jour des quotas de Google est celui du Pacifique ; la reprise se dit à l'heure de l'instance. */
describe('pacificDay', () => {
  it('compte encore la veille à 8 h à Paris en été', () => {
    expect(pacificDay(new Date('2026-07-16T06:00:00Z'))).toBe('2026-07-15');
  });
  it('bascule à minuit du Pacifique', () => {
    expect(pacificDay(new Date('2026-07-16T07:00:00Z'))).toBe('2026-07-16');
  });
});

describe('nextPacificMidnight', () => {
  it('heure d’été du Pacifique : minuit = 07:00 UTC', () => {
    expect(nextPacificMidnight(new Date('2026-07-16T12:00:00Z')).toISOString()).toBe('2026-07-17T07:00:00.000Z');
  });
  it('heure d’hiver : minuit = 08:00 UTC', () => {
    expect(nextPacificMidnight(new Date('2026-12-02T12:00:00Z')).toISOString()).toBe('2026-12-03T08:00:00.000Z');
  });
  it('veille du passage à l’heure d’hiver (1er novembre 2026)', () => {
    // 31 octobre 20:00 à Los Angeles (PDT) : le minuit suivant est déjà en PST.
    expect(nextPacificMidnight(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(nextPacificMidnight(new Date('2026-11-01T12:00:00Z')).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
  it('veille du passage à l’heure d’été (8 mars 2026)', () => {
    expect(nextPacificMidnight(new Date('2026-03-08T07:30:00Z')).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(nextPacificMidnight(new Date('2026-03-08T12:00:00Z')).toISOString()).toBe('2026-03-09T07:00:00.000Z');
  });
});

describe('resumeAt', () => {
  const tz = 'Europe/Paris';
  it('même jour : « à HH:MM », arrondi à la minute supérieure', () => {
    expect(resumeAt(new Date('2026-10-22T12:03:31Z'), new Date('2026-10-22T12:00:00Z'), tz)).toBe('à 14:04');
  });
  it('minute pile : pas d’arrondi', () => {
    expect(resumeAt(new Date('2026-10-22T12:04:00Z'), new Date('2026-10-22T12:00:00Z'), tz)).toBe('à 14:04');
  });
  it('autre jour : le jour est nommé, jamais « demain »', () => {
    expect(resumeAt(new Date('2026-10-23T07:00:00Z'), new Date('2026-10-22T20:00:00Z'), tz)).toBe('vendredi à 09:00');
  });
  it('l’arrondi qui passe minuit change de jour', () => {
    expect(resumeAt(new Date('2026-10-22T21:59:30Z'), new Date('2026-10-22T21:00:00Z'), tz)).toBe('vendredi à 00:00');
  });
});
