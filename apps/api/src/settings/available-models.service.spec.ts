import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHttp, json } from '../../test/fake-http.js';
import type { AppConfig } from '../common/config.js';
import { AvailableModelsService, isMainstreamGeminiModel } from './available-models.service.js';

const BASE_CONFIG = {
  VISION_PROVIDER: 'gemini',
  VISION_API_KEY: 'test-key',
  VISION_BASE_URL: undefined,
} as unknown as AppConfig;

/** Réponse `ListModels` telle que Gemini la rend : plusieurs familles mêlées. */
const LIST_MODELS = {
  models: [
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.5-transcribe', displayName: 'Transcribe', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-001', displayName: 'Instantané daté', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-live-translate-preview', displayName: 'Aperçu', supportedGenerationMethods: ['generateContent'] },
  ],
};

describe('AvailableModelsService', () => {
  const http = new FakeHttp();
  let service: AvailableModelsService;

  beforeEach(() => {
    http.reset();
    service = new AvailableModelsService(BASE_CONFIG, http.client);
  });

  it('ne garde que la ligne courante de Gemini', async () => {
    // La clé en déclare une soixantaine. Dérouler des instantanés datés, des
    // aperçus et des familles parole ou image pour choisir entre deux modèles
    // utilisables n'est pas tenable au téléphone.
    http.on('/v1beta/models', () => json(LIST_MODELS));
    const result = await service.list();
    expect(result.models.map((m) => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
    expect(result.unavailable).toBeUndefined();
  });

  it('rend la liste complète plutôt qu’un écran vide si le filtre ne laisse rien', async () => {
    // Famille renommée ou convention changée : mieux vaut une liste longue
    // qu'un choix impossible.
    http.on('/v1beta/models', () => json({ models: [{ name: 'models/nouvelle-famille-1', supportedGenerationMethods: ['generateContent'] }] }));
    const result = await service.list();
    expect(result.models.map((m) => m.id)).toEqual(['nouvelle-famille-1']);
  });

  it('passe la clé en en-tête et jamais dans l’URL', async () => {
    http.on('/v1beta/models', () => json(LIST_MODELS));
    await service.list();
    const call = http.calls[0]!;
    expect(call.url).not.toContain('test-key');
    expect((call.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('met la liste en cache plutôt que de rappeler l’API à chaque ouverture', async () => {
    http.on('/v1beta/models', () => json(LIST_MODELS));
    await service.list();
    await service.list();
    expect(http.calls).toHaveLength(1);
  });

  it('rend la panne à afficher plutôt que de lever, quand le fournisseur refuse', async () => {
    http.on('/v1beta/models', () => json({ error: 'nope' }, 429));
    const result = await service.list();
    expect(result.models).toEqual([]);
    expect(result.unavailable).toContain('429');
  });

  it('rend la panne à afficher quand le fournisseur est injoignable', async () => {
    http.fail('/v1beta/models');
    const result = await service.list();
    expect(result.models).toEqual([]);
    expect(result.unavailable).toMatch(/pas répondu/i);
  });

  it('ne tente rien sans clé API', async () => {
    const sansCle = new AvailableModelsService({ ...BASE_CONFIG, VISION_API_KEY: undefined } as AppConfig, http.client);
    const result = await sansCle.list();
    expect(result.unavailable).toMatch(/VISION_API_KEY/);
    expect(http.calls).toHaveLength(0);
  });

  it('ne tente rien quand le fournisseur configuré n’est pas Gemini', async () => {
    const ollama = new AvailableModelsService({ ...BASE_CONFIG, VISION_PROVIDER: 'none' } as AppConfig, http.client);
    const result = await ollama.list();
    expect(result.unavailable).toMatch(/Gemini/);
    expect(http.calls).toHaveLength(0);
  });
});

describe('isMainstreamGeminiModel', () => {
  it('garde les modèles de la ligne courante, quelle que soit la génération', () => {
    for (const id of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-pro', 'gemini-3.8-flash', 'gemini-4-pro']) {
      expect(isMainstreamGeminiModel(id)).toBe(true);
    }
  });

  it('écarte aperçus, expérimentations, instantanés datés et familles spécialisées', () => {
    for (const id of [
      'gemini-3.5-live-translate-preview',
      'gemini-2.0-flash-exp',
      'gemini-3.5-flash-001',
      'gemini-2.5-flash-2026-03-25',
      'gemini-3.5-transcribe',
      'gemini-2.5-flash-image',
      'gemini-live-2.5-flash',
      'text-embedding-004',
      'gemma-3-27b-it',
    ]) {
      expect(isMainstreamGeminiModel(id)).toBe(false);
    }
  });
});
