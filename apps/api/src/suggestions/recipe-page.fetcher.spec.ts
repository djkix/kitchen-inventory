import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../common/http-client.js';
import { RecipePageFetcher, RecipePageRefusedError } from './recipe-page.fetcher.js';

/**
 * Hôtes IP littéraux (documentation, RFC 5737) : aucune résolution DNS n'est
 * nécessaire pour les atteindre, donc aucun test ici ne dépend du réseau
 * (section 19) — la garde « adresse privée » (vigilance 2) est exercée par
 * son propre cas, avec une adresse RFC 1918 elle aussi littérale.
 */
const PUBLIC_HOST = '203.0.113.10';

async function fixtureHtml(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures/suggestions', file), 'utf8');
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function httpFor(html: string): HttpClient {
  return async () => htmlResponse(html);
}

describe('RecipePageFetcher (tâche 9, B6, B14)', () => {
  it('lit un schema.org/Recipe simple', async () => {
    const html = await fixtureHtml('page-schema-simple.html');
    const fetcher = new RecipePageFetcher(httpFor(html));

    const recipe = await fetcher.fetch(`https://${PUBLIC_HOST}/tarte-aux-pommes`);

    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe('Tarte aux pommes');
    expect(recipe?.ingredients).toContain('4 pommes');
    expect(recipe?.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('lit un Recipe imbriqué dans @graph (vigilance 5)', async () => {
    const html = await fixtureHtml('page-schema-graph.html');
    const fetcher = new RecipePageFetcher(httpFor(html));

    const recipe = await fetcher.fetch(`https://${PUBLIC_HOST}/curry-de-legumes`);

    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe('Curry de légumes');
    expect(recipe?.ingredients).toContain('1 oignon');
    expect(recipe?.steps).toContain('Laisser mijoter 20 minutes à couvert.');
  });

  it('lit un Recipe rendu dans un tableau JSON-LD (vigilance 5)', async () => {
    const html = await fixtureHtml('page-schema-tableau.html');
    const fetcher = new RecipePageFetcher(httpFor(html));

    const recipe = await fetcher.fetch(`https://${PUBLIC_HOST}/soupe-de-potiron`);

    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe('Soupe de potiron');
    expect(recipe?.ingredients).toContain('1 potiron');
  });

  it('rend null quand la page n’a pas de données structurées', async () => {
    const html = await fixtureHtml('page-sans-schema.html');
    const fetcher = new RecipePageFetcher(httpFor(html));

    const recipe = await fetcher.fetch(`https://${PUBLIC_HOST}/gratin-dauphinois`);

    expect(recipe).toBeNull();
  });

  it('rend null quand le JSON-LD n’est pas une recette', async () => {
    const html = await fixtureHtml('page-hors-sujet.html');
    const fetcher = new RecipePageFetcher(httpFor(html));

    const recipe = await fetcher.fetch(`https://${PUBLIC_HOST}/bienfaits-du-gratin`);

    expect(recipe).toBeNull();
  });

  it('rend null au-delà de cinq secondes, sans faire échouer l’appelant', async () => {
    // Un fournisseur qui ne répond jamais, sauf à l'abandon du signal : seule
    // façon de simuler un dépassement de délai sans vraiment attendre cinq
    // secondes réelles — `timeoutMs` est ici réduit pour un test rapide, la
    // valeur par défaut employée en production reste cinq secondes.
    const hanging: HttpClient = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Délai dépassé', 'AbortError')));
      });
    const fetcher = new RecipePageFetcher(hanging, 20);

    await expect(fetcher.fetch(`https://${PUBLIC_HOST}/trop-lente`)).resolves.toBeNull();
  });

  it('refuse une URL qui n’est pas en HTTPS', async () => {
    const fetcher = new RecipePageFetcher(async () => htmlResponse('<html></html>'));

    await expect(fetcher.fetch(`http://${PUBLIC_HOST}/recette`)).rejects.toBeInstanceOf(RecipePageRefusedError);
  });

  it('refuse une URL qui vise une adresse privée (vigilance 2)', async () => {
    const fetcher = new RecipePageFetcher(async () => htmlResponse('<html></html>'));

    await expect(fetcher.fetch('https://192.168.1.50/recette')).rejects.toBeInstanceOf(RecipePageRefusedError);
  });
});
