import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import type { SuggestionRequest } from './suggestion-provider.js';

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
    expect(result.model).toBe('gemini-3.5-pro');
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
    // gemini-3.5-pro : 2 $/Mtok en entrée, 12 $/Mtok en sortie (table de gemini.provider.ts).
    const expected = Math.round(((900 * 2 + 70 * 12) / 1_000_000) * 100 * 10_000) / 10_000;
    expect(result.costCents).toBe(expected);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it('rend un lot vide proprement quand le fournisseur ne propose rien', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-vide.json'));
    const result = await provider.suggest(BASE_REQUEST);
    expect(result.recipes).toEqual([]);
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
