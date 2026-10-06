import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHttp, json } from '../../test/fake-http.js';
import type { AppConfig } from '../common/config.js';
import { AvailableModelsService } from './available-models.service.js';

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
  ],
};

describe('AvailableModelsService', () => {
  const http = new FakeHttp();
  let service: AvailableModelsService;

  beforeEach(() => {
    http.reset();
    service = new AvailableModelsService(BASE_CONFIG, http.client);
  });

  it('ne garde que les modèles capables de générer du texte', async () => {
    http.on('/v1beta/models', () => json(LIST_MODELS));
    const result = await service.list();
    expect(result.models.map((m) => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-transcribe']);
    expect(result.unavailable).toBeUndefined();
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
    const ollama = new AvailableModelsService({ ...BASE_CONFIG, VISION_PROVIDER: 'ollama' } as AppConfig, http.client);
    const result = await ollama.list();
    expect(result.unavailable).toMatch(/Gemini/);
    expect(http.calls).toHaveLength(0);
  });
});
