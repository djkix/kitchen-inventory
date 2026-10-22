import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { MediaService } from '../media/media.service.js';
import { GeminiReceiptReader, RECEIPT_MIME_TYPES } from './gemini-receipt.reader.js';

const FILE = Buffer.from('ticket');

describe('GeminiReceiptReader (EF-29)', () => {
  let http: FakeHttp;
  let reader: GeminiReceiptReader;

  beforeEach(() => {
    http = new FakeHttp();
    reader = new GeminiReceiptReader({ apiKey: 'test-key', httpClient: http.client });
  });

  it('ne rend que les produits, dans l’ordre, avec leur quantité', async () => {
    http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    const { lines, costCents } = await reader.read(FILE, 'image/jpeg');
    expect(lines).toEqual([
      { label: 'RIZ BASMATI 1KG', quantity: 3 },
      { label: 'LAIT DEMI ECR', quantity: 1 },
    ]);
    expect(costCents).not.toBeNull();
  });

  it('envoie le fichier en inlineData, un schéma, la clé en en-tête et le modèle demandé', async () => {
    http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await reader.read(FILE, 'application/pdf', 'gemini-3.5-flash');
    const call = http.calls[0]!;
    const body = JSON.parse(String(call.init?.body));
    expect(call.url).toContain('/models/gemini-3.5-flash:generateContent');
    expect(call.url).not.toContain('test-key');
    expect((call.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'application/pdf', data: FILE.toString('base64') });
    expect(body.generationConfig.responseSchema.type).toBe('ARRAY');
  });

  it('refuse une réponse sans aucun produit, en français', async () => {
    http.on('generateContent', () => json({ candidates: [{ content: { parts: [{ text: '[]' }] }, finishReason: 'STOP' }] }));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/Aucun produit lisible/);
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toBeInstanceOf(ProviderError);
  });

  it('refuse un texte qui n’est pas du JSON', async () => {
    http.on('generateContent', () => json({ candidates: [{ content: { parts: [{ text: 'désolé' }] }, finishReason: 'STOP' }] }));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/exploitable/);
  });

  it('passe un 429 par le message de quota', async () => {
    http.on('generateContent', () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }, { retryDelay: '12s' }] } }, 429));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/Trop de demandes coup sur coup\. Réessayez dans \d+ secondes?\./);
  });

  it('rend une erreur nette sur clé refusée et sur panne réseau', async () => {
    http.on('generateContent', () => json({}, 403));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow('Clé API Gemini refusée');
    http.reset();
    http.fail('generateContent');
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/injoignable/);
  });
});

describe('types acceptés (EF-29)', () => {
  it('le ticket accepte le PDF et les images du scan', () => {
    expect(RECEIPT_MIME_TYPES).toContain('application/pdf');
    expect(RECEIPT_MIME_TYPES).toContain('image/jpeg');
  });

  it('le scan photo, lui, refuse toujours le PDF : MediaService n’est pas élargi', () => {
    const media = new MediaService({ mediaDir: '/nulle-part' } as never);
    expect(media.isSupportedMime('application/pdf')).toBe(false);
    expect(media.isSupportedMime('image/jpeg')).toBe(true);
  });
});
