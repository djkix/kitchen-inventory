import { describe, expect, it } from 'vitest';
import { pinnedHttpsFetch, pinnedLookup, pinnedRequestOptions } from './http-client.js';

/**
 * Épinglage de la connexion (revue de sécurité du 2026-10-22) : la résolution
 * DNS est court-circuitée, le nom ne sert plus qu'à SNI et à `Host`. Aucune
 * connexion n'est ouverte ici.
 */
describe('pinnedLookup', () => {
  it('rend toujours l’adresse épinglée, quel que soit le nom demandé', async () => {
    const lookup = pinnedLookup('198.51.100.7');
    const one = await new Promise<unknown[]>((resolve) => lookup('interne.example', {}, (...args) => resolve(args)));
    expect(one).toEqual([null, '198.51.100.7', 4]);
    const all = await new Promise<unknown[]>((resolve) => lookup('interne.example', { all: true }, (...args) => resolve(args)));
    expect(all).toEqual([null, [{ address: '198.51.100.7', family: 4 }]]);
  });

  it('connaît la famille IPv6, et refuse ce qui n’est pas une adresse', () => {
    const lookup = pinnedLookup('2606:4700::1111');
    lookup('x', {}, (_err, _address, family) => expect(family).toBe(6));
    expect(() => pinnedLookup('localhost')).toThrow();
  });
});

describe('pinnedRequestOptions', () => {
  it('garde le nom pour SNI et Host, et fige la destination', () => {
    const options = pinnedRequestOptions(new URL('https://recettes.example:8443/a?b=1'), '198.51.100.7', new Headers({ accept: 'text/html' }));
    expect(options).toMatchObject({ hostname: 'recettes.example', port: 8443, path: '/a?b=1', servername: 'recettes.example', agent: false, method: 'GET' });
    expect(options.headers).toMatchObject({ accept: 'text/html', 'accept-encoding': 'identity' });
    expect(typeof options.lookup).toBe('function');
  });

  it('n’envoie pas de SNI vers une adresse littérale', () => {
    expect(pinnedRequestOptions(new URL('https://[2606:4700::1111]/'), '2606:4700::1111', new Headers()).servername).toBeUndefined();
  });

  it('refuse autre chose que https', async () => {
    expect(() => pinnedRequestOptions(new URL('http://recettes.example/'), '198.51.100.7', new Headers())).toThrow('https');
    await expect(pinnedHttpsFetch('http://recettes.example/', '198.51.100.7')).rejects.toThrow('https');
  });
});
