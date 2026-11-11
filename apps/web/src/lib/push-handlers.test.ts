import { describe, expect, it } from 'vitest';
import { clientToFocus, notificationOptions, readPushMessage, sameOriginPath } from './push-handlers';

describe('readPushMessage', () => {
  it('lit le message du serveur', () => {
    const message = readPushMessage(JSON.stringify({ title: '6 idées de recettes', body: 'Touchez pour les voir.', url: '/recettes/suggestions', tag: 'req-1' }));
    expect(message).toEqual({ title: '6 idées de recettes', body: 'Touchez pour les voir.', url: '/recettes/suggestions', tag: 'req-1' });
  });

  // Une notification muette serait pire qu'une notification générique : on
  // saurait qu'il s'est passé quelque chose sans savoir quoi.
  it('se rabat sur un texte générique quand le message est illisible', () => {
    expect(readPushMessage('{ pas du json').title).toBe('Votre demande est prête');
    expect(readPushMessage(null).title).toBe('Votre demande est prête');
    expect(readPushMessage(JSON.stringify({ body: 'sans titre' })).title).toBe('Votre demande est prête');
  });

  it('se rabat sur la racine quand l’adresse manque', () => {
    expect(readPushMessage(JSON.stringify({ title: 'T', body: 'B' })).url).toBe('/');
  });
});

describe('notificationOptions', () => {
  it('porte le tag, pour que deux annonces de la même demande ne s’empilent pas', () => {
    const options = notificationOptions({ title: 'T', body: 'B', url: '/stock', tag: 'req-7' });
    expect(options.tag).toBe('req-7');
    expect(options.data).toEqual({ url: '/stock' });
  });
});

describe('clientToFocus', () => {
  it('réveille un onglet déjà ouvert sur l’application', () => {
    const clients = [{ url: 'https://autre.example/' }, { url: 'https://kitchen.example/stock' }];
    expect(clientToFocus(clients, 'https://kitchen.example')).toEqual({ url: 'https://kitchen.example/stock' });
  });

  it('rend null quand aucun onglet n’est ouvert : il faudra en ouvrir un', () => {
    expect(clientToFocus([{ url: 'https://autre.example/' }], 'https://kitchen.example')).toBeNull();
  });
});

describe('sameOriginPath (audit du 2026-11-11)', () => {
  const ORIGIN = 'https://kitchen.example';

  it('garde un chemin de l’application, avec sa requête', () => {
    expect(sameOriginPath('/recettes/parler?demande=7', ORIGIN)).toBe('/recettes/parler?demande=7');
    expect(sameOriginPath(`${ORIGIN}/stock`, ORIGIN)).toBe('/stock');
  });

  it('ramène à l’accueil tout ce qui mènerait ailleurs', () => {
    expect(sameOriginPath('https://ailleurs.example/piege', ORIGIN)).toBe('/');
    expect(sameOriginPath('javascript:alert(1)', ORIGIN)).toBe('/');
    expect(sameOriginPath(undefined, ORIGIN)).toBe('/');
  });
});
