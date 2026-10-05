import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import type { SuggestionProviderError, SuggestionRequest } from './suggestion-provider.js';

const BASE_REQUEST: SuggestionRequest = { seeds: ['tomate', 'pâtes', 'basilic'], count: 12 };

function requestBody(http: FakeHttp, index = 0): any {
  return JSON.parse(String(http.calls[index]?.init?.body));
}

async function fixtureText(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures/suggestions', file), 'utf8');
}

describe('GeminiSuggestionProvider (EF-26)', () => {
  let http: FakeHttp;
  let provider: GeminiSuggestionProvider;

  beforeEach(() => {
    http = new FakeHttp();
    provider = new GeminiSuggestionProvider({ apiKey: 'test-key', httpClient: http.client });
  });

  it('rend douze recettes depuis une réponse conforme', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch.json'));
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toHaveLength(12);
    expect(result.recipes.filter((r) => r.provenance === 'web')).toHaveLength(8);
    expect(result.recipes.filter((r) => r.provenance === 'ai')).toHaveLength(4);
    expect(result.model).toBe('gemini-3.5-flash-lite');
  });

  it('extrait le JSON encadré par des clôtures ``` (vigilance 1)', async () => {
    const batch = await fixtureText('gemini-batch.json');
    const fenced = '```json\n' + batch.trim() + '\n```';
    http.on('generateContent', () =>
      json({ candidates: [{ content: { role: 'model', parts: [{ text: fenced }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }),
    );
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toHaveLength(12);
  });

  it('reprend une fois quand le JSON est invalide, puis échoue proprement', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-invalide.json'));
    await expect(provider.suggest(BASE_REQUEST)).rejects.toThrow(ProviderError);
    // Deux appels au plus : la demande initiale et une seule reprise, jamais une troisième tentative.
    expect(http.calls).toHaveLength(2);
    const secondPrompt = requestBody(http, 1).contents[0].parts[0].text as string;
    expect(secondPrompt).toContain("n'était pas exploitable");
  });

  it('écarte la seule recette mal formée et garde les autres, sans second appel payant', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-une-recette-cassee.json'));
    const result = await provider.suggest(BASE_REQUEST);
    // Onze recettes sur douze : la quatrième porte une URL `http://`, elle seule est écartée.
    expect(result.recipes).toHaveLength(11);
    expect(result.recipes.map((r) => r.title)).not.toContain('Recette web 4');
    // Une seule recette fautive ne déclenche plus la reprise : un appel, pas deux.
    expect(http.calls).toHaveLength(1);
  });

  it('accepte une URL source écrite « HTTPS:// » en majuscules', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-une-recette-cassee.json'));
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes.find((r) => r.title === 'Recette web 6')?.sourceUrl).toBe('HTTPS://exemple-cuisine-6.test/recette-6');
  });

  it("n'envoie pas responseSchema quand la recherche web est activée (vigilance 1)", async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch.json'));
    await provider.suggest(BASE_REQUEST);
    const body = requestBody(http);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig?.responseSchema).toBeUndefined();
  });

  it('porte la région, la durée et la difficulté demandées dans le prompt (B9)', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch.json'));
    await provider.suggest({ ...BASE_REQUEST, region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
    const prompt = requestBody(http).contents[0].parts[0].text as string;
    expect(prompt).toContain('Asiatique');
    expect(prompt).toContain('30 minutes');
    expect(prompt).toContain('Facile');
  });

  it('calcule un coût à partir de usageMetadata', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch.json'));
    const result = await provider.suggest(BASE_REQUEST);
    // gemini-3.5-flash-lite : 0,1 $/Mtok en entrée, 0,4 $/Mtok en sortie (table de gemini.provider.ts).
    const expected = Math.round(((900 * 0.1 + 70 * 0.4) / 1_000_000) * 100 * 10_000) / 10_000;
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.costCents).toBe(expected);
    expect(result.attempts[0]?.costCents).toBeGreaterThan(0);
  });

  it('rend un lot vide proprement quand le fournisseur ne propose rien', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-vide.json'));
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toEqual([]);
  });

  it('rend les deux tentatives facturées quand la reprise réussit (Important 2)', async () => {
    let call = 0;
    http.on('generateContent', () => {
      call += 1;
      return call === 1 ? geminiFixture('suggestions/gemini-batch-invalide.json') : geminiFixture('suggestions/gemini-batch.json');
    });
    const result = await provider.suggest(BASE_REQUEST);
    expect(http.calls).toHaveLength(2);
    // Les deux appels ont consommé des jetons : les deux doivent remonter.
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => (a.costCents ?? 0) > 0)).toBe(true);
  });

  it('porte les tentatives déjà facturées sur l’erreur quand la reprise échoue aussi', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-invalide.json'));
    await expect(provider.suggest(BASE_REQUEST)).rejects.toMatchObject({ attempts: expect.any(Array) });
    try {
      await provider.suggest(BASE_REQUEST);
    } catch (error) {
      expect((error as SuggestionProviderError).attempts).toHaveLength(2);
    }
  });

  it('est désactivé sans clé, et le dit', async () => {
    const disabled = new GeminiSuggestionProvider({ httpClient: http.client });
    expect(disabled.enabled).toBe(false);
    await expect(disabled.suggest(BASE_REQUEST)).rejects.toThrow(ProviderError);
    expect(http.calls).toHaveLength(0);
  });

  it('tronque au nombre de recettes demandé quand le fournisseur en rend davantage', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-trop-plein.json'));
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toHaveLength(12);
    expect(http.calls).toHaveLength(1);
  });

  it('extrait le JSON malgré du texte superflu avant et après l’objet', async () => {
    const batch = await fixtureText('gemini-batch.json');
    const withProse = `Voici le lot demandé :\n${batch.trim()}\nFin de la réponse.`;
    http.on('generateContent', () =>
      json({
        candidates: [{ content: { role: 'model', parts: [{ text: withProse }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      }),
    );
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toHaveLength(12);
  });

  it('échoue distinctement, sans reprise, quand la réponse est tronquée par la limite de jetons', async () => {
    http.on('generateContent', () =>
      json({
        candidates: [{ content: { role: 'model', parts: [{ text: '{ "recipes": [ { "title": "incomplet"' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8192 },
      }),
    );
    await expect(provider.suggest(BASE_REQUEST)).rejects.toThrow(/tronqu/);
    // Pas de reprise : redemander le même volume dans le même budget ne ferait que retronquer.
    expect(http.calls).toHaveLength(1);
  });
});
