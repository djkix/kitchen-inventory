import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { PRICES_USD_PER_MTOK } from '../recognition/providers/gemini.provider.js';
import { buildSuggestionPrompt, buildVoicePrompt, KNOWN_TITLES_CAP } from './prompt.js';
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

/**
 * La demande de djkix du 2026-10-19 — « diversifie les propositions (pas de
 * variante) » — se joue entièrement dans le texte envoyé au modèle : ces cas
 * épinglent les deux consignes qui la portent.
 */
describe('buildSuggestionPrompt, diversité des propositions (2026-10-19)', () => {
  it('exige des plats nettement différents, jamais deux variantes du même', () => {
    const prompt = buildSuggestionPrompt(BASE_REQUEST);
    expect(prompt).toContain('nettement différentes');
    expect(prompt).toContain('variante');
    expect(prompt).not.toContain('Aucune variété');
  });

  it('exige la même diversité sans recherche web', () => {
    const prompt = buildSuggestionPrompt({ ...BASE_REQUEST, webSearch: false });
    expect(prompt).toContain('nettement différentes');
    expect(prompt).not.toContain('Aucune variété');
  });

  it('cite les titres déjà connus et interdit de les reproposer', () => {
    const prompt = buildSuggestionPrompt({ ...BASE_REQUEST, knownTitles: ['Fusilli aux abricots', 'Tarte aux pommes'] });
    expect(prompt).toMatch(/Ne propose aucune de ces recettes/);
    expect(prompt).toContain('Fusilli aux abricots');
    expect(prompt).toContain('Tarte aux pommes');
  });

  it('ne cite aucune recette connue quand le réservoir est vide pour cette orientation', () => {
    expect(buildSuggestionPrompt({ ...BASE_REQUEST, knownTitles: [] })).not.toMatch(/Ne propose aucune de ces recettes/);
  });

  it('borne la liste des titres connus pour que le prompt n’enfle pas', () => {
    const titles = Array.from({ length: KNOWN_TITLES_CAP + 5 }, (_, i) => `Recette ${i}`);
    const prompt = buildSuggestionPrompt({ ...BASE_REQUEST, knownTitles: titles });
    // Les plus récents d'abord : le service lit le réservoir par date de
    // première apparition décroissante, la borne coupe donc la queue.
    expect(prompt).toContain(`Recette ${KNOWN_TITLES_CAP - 1} `);
    expect(prompt).not.toContain(`Recette ${KNOWN_TITLES_CAP} `);
  });

  it('garde la consigne d’orientation malgré la diversité demandée', () => {
    const prompt = buildSuggestionPrompt({ ...BASE_REQUEST, region: 'asiatique', difficulty: 'EASY' });
    expect(prompt).toContain('vers la cuisine Asiatique');
    expect(prompt).toContain('nettement différentes');
  });
});

/**
 * Demande parlée (spécification du 2026-10-21). Aucun test n'envoie d'audio
 * réel : un `Buffer` d'octets quelconques suffit à vérifier ce qui est en jeu
 * — ce qui part dans la requête, ce qui en revient, et ce que ça coûte.
 */
describe('GeminiSuggestionProvider.suggestFromVoice (D2, D4, D7)', () => {
  let http: FakeHttp;
  let provider: GeminiSuggestionProvider;
  const AUDIO = Buffer.from('des-octets-qui-ne-sont-pas-de-la-parole');
  const VOICE_REQUEST = { seeds: ['tomate', 'pâtes'], count: 12, audio: AUDIO, mimeType: 'audio/webm' };

  beforeEach(() => {
    http = new FakeHttp();
    provider = new GeminiSuggestionProvider({ apiKey: 'test-key', httpClient: http.client });
  });

  it('rend la lecture du modèle ET les recettes en un seul appel (D2, D4)', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));
    const result = await provider.suggestFromVoice(VOICE_REQUEST);
    expect(result.heard.ingredients).toEqual(['poulet', 'sauce tomate']);
    expect(result.heard.orientation).toBe('plat italien');
    expect(result.recipes.length).toBeGreaterThan(0);
    expect(http.calls).toHaveLength(1);
  });

  it('envoie l’audio en pièce jointe, avec son type', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));
    await provider.suggestFromVoice(VOICE_REQUEST);
    const parts = requestBody(http).contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('audio/webm');
    expect(parts[0].inlineData.data).toBe(AUDIO.toString('base64'));
    // La consigne de lecture part avec l'audio, dans le même appel.
    expect(parts[1].text).toMatch(/heard/);
  });

  it('facture l’appel au tarif audio quand la ventilation est absente (D7)', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));
    const voice = await provider.suggestFromVoice(VOICE_REQUEST);
    // `geminiFixture` rend 900 jetons d'entrée et 70 de sortie, sans
    // ventilation : le repli de D7 les facture tous au tarif audio.
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const expected = Math.round(((900 * price.audio + 70 * price.output) / 1_000_000) * 100 * 10_000) / 10_000;
    expect(voice.attempts[0]?.costCents).toBe(expected);
    // Et c'est bien plus que ce qu'un appel écrit de même volume aurait coûté.
    const written = await provider.suggest(BASE_REQUEST);
    expect(voice.attempts[0]!.costCents!).toBeGreaterThan(written.attempts[0]!.costCents!);
  });

  it('échoue sans reprise quand la réponse est illisible : une reprise renverrait l’audio', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-invalide.json'));
    await expect(provider.suggestFromVoice(VOICE_REQUEST)).rejects.toThrow(ProviderError);
    expect(http.calls).toHaveLength(1);
  });

  it('porte la tentative facturée sur l’erreur, pour qu’elle soit journalisée', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-invalide.json'));
    await expect(provider.suggestFromVoice(VOICE_REQUEST)).rejects.toMatchObject({ attempts: [expect.objectContaining({ costCents: expect.any(Number) })] });
  });

  it('facture une réponse 200 que le modèle refuse ensuite (tour de correction 1)', async () => {
    // `blockReason` et `MAX_TOKENS` arrivent dans une réponse 200 : Google l'a
    // facturée. Lever sans l'inscrire la faisait journaliser `costCents: null`,
    // donc échapper au plafond mensuel — sur l'appel le plus cher du produit.
    http.on('generateContent', () =>
      json({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 0 } }),
    );
    await expect(provider.suggestFromVoice(VOICE_REQUEST)).rejects.toMatchObject({
      attempts: [expect.objectContaining({ costCents: expect.any(Number) })],
    });

    http.reset();
    http.on('generateContent', () =>
      json({
        candidates: [{ content: { parts: [{ text: '{ "heard"' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 8192 },
      }),
    );
    let billed: number | null | undefined;
    try {
      await provider.suggestFromVoice(VOICE_REQUEST);
    } catch (error) {
      billed = (error as SuggestionProviderError).attempts[0]?.costCents;
    }
    expect(billed).toBeGreaterThan(0);
  });

  it('est désactivé sans clé, et n’envoie rien', async () => {
    const disabled = new GeminiSuggestionProvider({ httpClient: http.client });
    await expect(disabled.suggestFromVoice(VOICE_REQUEST)).rejects.toThrow(ProviderError);
    expect(http.calls).toHaveLength(0);
  });
});

describe('buildVoicePrompt (D2, D4)', () => {
  const req = { seeds: ['tomate', 'pâtes'], count: 12, audio: Buffer.alloc(0), mimeType: 'audio/webm' };

  it('demande la lecture de la phrase et les recettes dans le même objet JSON', () => {
    const prompt = buildVoicePrompt(req);
    expect(prompt).toMatch(/heard/);
    expect(prompt).toMatch(/ingredients/);
    expect(prompt).toMatch(/orientation/);
    expect(prompt).toMatch(/recipes/);
  });

  it('croise la parole avec le stock réel, qui est toute la valeur de la fonction', () => {
    const prompt = buildVoicePrompt(req);
    expect(prompt).toContain('tomate, pâtes');
    expect(prompt).toMatch(/enregistrement|audio|parl/i);
  });

  it('garde la consigne de diversité des propositions', () => {
    expect(buildVoicePrompt(req)).toContain('nettement différentes');
  });
});
