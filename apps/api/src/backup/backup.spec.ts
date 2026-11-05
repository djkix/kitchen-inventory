import { describe, expect, it } from 'vitest';
import { backupWarnings } from './backup.js';

const now = new Date('2026-10-23T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('backupWarnings', () => {
  it('ne dit rien quand le service n’a jamais tourné', () => {
    expect(backupWarnings(null, null, now)).toEqual([]);
  });

  it('ne dit rien après une réussite récente', () => {
    expect(backupWarnings({ finishedAt: hoursAgo(10), succeeded: true, message: '' }, hoursAgo(10), now)).toEqual([]);
  });

  it('signale un échec, avec son message technique', () => {
    expect(backupWarnings({ finishedAt: hoursAgo(1), succeeded: false, message: 'étape base (code 1)' }, hoursAgo(20), now)).toEqual([
      'La dernière sauvegarde a échoué : étape base (code 1).',
    ]);
  });

  it('signale l’absence de réussite depuis 36 h', () => {
    expect(backupWarnings({ finishedAt: hoursAgo(40), succeeded: true, message: '' }, hoursAgo(40), now)).toEqual([
      'Aucune sauvegarde réussie depuis 36 h.',
    ]);
  });

  it('sans aucune réussite, mesure depuis la dernière tentative', () => {
    const last = { finishedAt: hoursAgo(37), succeeded: false, message: 'étape medias (code 23)' };
    expect(backupWarnings(last, null, now)).toHaveLength(2);
    expect(backupWarnings({ ...last, finishedAt: hoursAgo(2) }, null, now)).toHaveLength(1);
  });
});
