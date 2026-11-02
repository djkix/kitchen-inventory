import { describe, expect, it } from 'vitest';
import { DEFERRAL_CEILING_MS, deferralRetryAt, notificationPayload, shouldNotify } from './ai-requests.js';

describe('shouldNotify : qui mérite une notification (D1, D1b)', () => {
  it('ne dit rien quand on est resté devant l’écran', () => {
    expect(shouldNotify({ leftScreen: false, wasDeferred: false })).toBe(false);
  });

  it('annonce quand l’écran a été quitté', () => {
    expect(shouldNotify({ leftScreen: true, wasDeferred: false })).toBe(true);
  });

  // D1b : au bout de vingt minutes, personne n'est resté devant l'écran. La
  // règle du départ de page ne s'applique pas à une demande différée, sans
  // quoi son résultat ne serait annoncé nulle part.
  it('annonce une demande différée même sans avoir quitté l’écran', () => {
    expect(shouldNotify({ leftScreen: false, wasDeferred: true })).toBe(true);
  });
});

describe('deferralRetryAt : jusqu’où il est raisonnable d’attendre (D6)', () => {
  const now = new Date('2026-11-02T22:00:00Z');

  it('retient une reprise annoncée dans le plafond', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-02T22:20:00Z') })).toEqual(new Date('2026-11-02T22:20:00Z'));
  });

  it('abandonne au-delà d’une heure plutôt que de réveiller', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-03T07:00:00Z') })).toBeNull();
  });

  it('accepte la reprise qui tombe pile sur le plafond', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date(now.getTime() + DEFERRAL_CEILING_MS) })).toEqual(new Date(now.getTime() + DEFERRAL_CEILING_MS));
  });

  // Une reprise déjà passée arrive quand la pause s'est levée entre le refus
  // et l'enregistrement : rejouer tout de suite, et non attendre une date morte.
  it('accepte une reprise déjà passée : le rejeu est immédiat', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-02T21:59:00Z') })).toEqual(now);
  });
});

describe('notificationPayload : ce que le téléphone affiche', () => {
  it('nomme ce qui est prêt plutôt que « traitement terminé »', () => {
    const payload = notificationPayload({ id: 'req-a', kind: 'SUGGESTIONS', outcome: 'DONE', count: 6 });
    expect(payload.title).toBe('6 idées de recettes');
    expect(payload.url).toBe('/recettes');
    expect(payload.tag).toBe('req-a');
  });

  it('accorde le singulier', () => {
    expect(notificationPayload({ id: 'req-b', kind: 'SUGGESTIONS', outcome: 'DONE', count: 1 }).title).toBe('1 idée de recette');
  });

  it('nomme le ticket et renvoie sur l’écran des courses', () => {
    const payload = notificationPayload({ id: 'req-c', kind: 'RECEIPT', outcome: 'DONE', count: 12 });
    expect(payload.title).toBe('Ticket lu : 12 lignes');
    expect(payload.url).toBe('/courses');
  });

  it('renvoie l’article scanné sur le stock', () => {
    expect(notificationPayload({ id: 'req-d', kind: 'SCAN_IMAGE', outcome: 'DONE' }).url).toBe('/');
  });

  it('dit la raison d’un abandon plutôt que de rester muet', () => {
    const payload = notificationPayload({ id: 'req-e', kind: 'VOICE', outcome: 'ABANDONED', reason: 'Le quota du jour est atteint.' });
    expect(payload.title).toBe('Demande abandonnée');
    expect(payload.body).toContain('Le quota du jour est atteint.');
  });

  // Le `tag` fait que deux annonces de la même demande n'empilent pas deux
  // notifications : la seconde remplace la première.
  it('marque chaque notification du nom de sa demande', () => {
    expect(notificationPayload({ id: 'req-f', kind: 'VOICE', outcome: 'DONE', count: 3 }).tag).toBe('req-f');
  });
});
