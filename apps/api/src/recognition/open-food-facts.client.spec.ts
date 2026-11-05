import { describe, expect, it } from 'vitest';
import type { Logger } from 'nestjs-pino';
import { loadConfig } from '../common/config.js';
import type { HttpClient, HttpRequestInit } from '../common/http-client.js';
import { isAllowedOffImageUrl, OFF_IMAGE_MAX_BYTES, OpenFoodFactsClient } from './open-food-facts.client.js';

/** Téléchargement de la photo d'un produit (revue de sécurité du 2026-10-22). Aucun réseau : client HTTP doublé. */
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://k:k@db:5432/k', SECRET_KEY: 'x'.repeat(32) });
const logger = { warn: () => undefined, log: () => undefined } as unknown as Logger;
const IMAGE = 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.400.jpg';

function clientWith(http: HttpClient): OpenFoodFactsClient {
  return new OpenFoodFactsClient(config, http, logger);
}

describe('isAllowedOffImageUrl', () => {
  it.each([IMAGE, 'https://static.openfoodfacts.org/images/products/x.jpg'])('accepte %s', (url) => {
    expect(isAllowedOffImageUrl(url)).toBe(true);
  });

  it.each([
    'http://images.openfoodfacts.org/images/x.jpg', // pas de HTTPS
    'https://images.openfoodfacts.org.attaquant.example/x.jpg',
    'https://attaquant.example/images.openfoodfacts.org/x.jpg',
    'https://127.0.0.1/x.jpg',
    'https://192.168.1.10/x.jpg',
    'https://images.openfoodfacts.org:8443/x.jpg',
    'https://user:pass@images.openfoodfacts.org/x.jpg',
    'file:///etc/passwd',
    'pas une url',
  ])('refuse %s', (url) => {
    expect(isAllowedOffImageUrl(url)).toBe(false);
  });
});

describe('OpenFoodFactsClient.downloadImage', () => {
  it('télécharge une image d’un hôte autorisé, sans suivre de redirection et avec un délai', async () => {
    let init: HttpRequestInit | undefined;
    const client = clientWith(async (_url, i) => {
      init = i;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    });
    const image = await client.downloadImage(IMAGE);
    expect(image).toEqual({ buffer: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' });
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('n’appelle jamais un hôte hors liste', async () => {
    let called = false;
    const client = clientWith(async () => {
      called = true;
      return new Response('x');
    });
    expect(await client.downloadImage('https://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(called).toBe(false);
  });

  it('rend null quand le client refuse une redirection', async () => {
    const client = clientWith(async () => {
      throw new TypeError('redirect mode is set to error');
    });
    expect(await client.downloadImage(IMAGE)).toBeNull();
  });

  it('refuse une taille annoncée au-delà du plafond, sans lire le corps', async () => {
    const client = clientWith(async () => new Response('x', { headers: { 'content-length': String(OFF_IMAGE_MAX_BYTES + 1) } }));
    expect(await client.downloadImage(IMAGE)).toBeNull();
  });

  it('coupe un flux qui dépasse le plafond, plutôt que de le garder en mémoire', async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = clientWith(async () => new Response(stream, { headers: { 'content-type': 'image/jpeg' } }));
    expect(await client.downloadImage(IMAGE)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });
});
