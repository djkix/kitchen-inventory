import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Client HTTP de test : rejoue des fixtures locales, n'ouvre jamais de socket.
 * Chaque route est une fonction qui reçoit l'URL et l'init de la requête.
 */
export class FakeHttp {
  readonly calls: Array<{ url: string; init?: RequestInit }> = [];
  private readonly routes: Array<{ match: (url: string) => boolean; handler: (url: string, init?: RequestInit) => Promise<Response> | Response }> = [];

  /** Oublie les routes et l'historique d'appels entre deux tests. */
  reset(): void {
    this.routes.length = 0;
    this.calls.length = 0;
  }

  on(match: string | RegExp, handler: (url: string, init?: RequestInit) => Promise<Response> | Response): this {
    this.routes.push({ match: (url) => (typeof match === 'string' ? url.includes(match) : match.test(url)), handler });
    return this;
  }

  fixture(match: string | RegExp, file: string, status = 200): this {
    return this.on(match, async () => json(JSON.parse(await readFile(resolve(import.meta.dirname, 'fixtures', file), 'utf8')), status));
  }

  fail(match: string | RegExp, message = 'ECONNREFUSED'): this {
    return this.on(match, () => Promise.reject(new Error(message)));
  }

  get client(): HttpClient {
    return async (url, init) => {
      this.calls.push({ url, init });
      const route = this.routes.find((r) => r.match(url));
      if (!route) throw new Error(`Aucune fixture pour ${url}`);
      return route.handler(url, init);
    };
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Réponse d'un fournisseur de vision au format « Anthropic Messages » qui encapsule le JSON strict. */
export async function anthropicFixture(file: string): Promise<Response> {
  const content = await readFile(resolve(import.meta.dirname, 'fixtures', file), 'utf8');
  return json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: content }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 80 },
  });
}

/** Réponse au format `generateContent` de Gemini qui encapsule le JSON strict. */
export async function geminiFixture(file: string): Promise<Response> {
  const content = await readFile(resolve(import.meta.dirname, 'fixtures', file), 'utf8');
  return json({
    candidates: [{ content: { role: 'model', parts: [{ text: content }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 70, totalTokenCount: 970 },
    modelVersion: 'gemini-3.5-flash',
  });
}

/** Un PNG 1×1 valide : suffit pour tester le téléversement sans dépendre d'une vraie photo. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
