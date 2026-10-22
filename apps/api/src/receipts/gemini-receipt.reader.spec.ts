import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { GeminiPausedError } from '../gemini/gemini-errors.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { MediaService } from '../media/media.service.js';
import { GeminiReceiptReader, ReceiptReadError, RECEIPT_MIME_TYPES } from './gemini-receipt.reader.js';

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

  it('envoie le fichier en inlineData, le JSON par la consigne sans responseSchema, la clé en en-tête et le modèle demandé', async () => {
    http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await reader.read(FILE, 'application/pdf', 'gemini-3.5-flash');
    const call = http.calls[0]!;
    const body = JSON.parse(String(call.init?.body));
    expect(call.url).toContain('/models/gemini-3.5-flash:generateContent');
    expect(call.url).not.toContain('test-key');
    expect((call.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'application/pdf', data: FILE.toString('base64') });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.systemInstruction.parts[0].text).toContain('tableau JSON strict');
  });

  it('tolère les clôtures ```json et un tableau enveloppé dans {"items": …}', async () => {
    const line = '[{"label":"RIZ","quantity":2,"kind":"PRODUCT"}]';
    for (const text of ['```json\n' + line + '\n```', `{"items": ${line}}`]) {
      http.reset();
      http.on('generateContent', () => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }));
      expect((await reader.read(FILE, 'image/jpeg')).lines, text).toEqual([{ label: 'RIZ', quantity: 2 }]);
    }
  });

  it('refuse une réponse sans aucun produit, en français', async () => {
    http.on('generateContent', () => json({ candidates: [{ content: { parts: [{ text: '[]' }] }, finishReason: 'STOP' }] }));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/Aucun produit lisible/);
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toBeInstanceOf(ProviderError);
  });

  it('une lecture facturée qui échoue porte son coût (plafond mensuel)', async () => {
    const usage = { promptTokenCount: 1000, candidatesTokenCount: 5 };
    const cases: Array<[string, unknown]> = [
      ['ticket vide', { candidates: [{ content: { parts: [{ text: '[]' }] }, finishReason: 'STOP' }], usageMetadata: usage }],
      ['JSON illisible', { candidates: [{ content: { parts: [{ text: 'désolé' }] }, finishReason: 'STOP' }], usageMetadata: usage }],
      ['MAX_TOKENS', { candidates: [{ content: { parts: [{ text: '[' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: usage }],
      ['sans candidat', { usageMetadata: usage }],
      ['bloquée', { promptFeedback: { blockReason: 'SAFETY' }, candidates: [{ content: { parts: [{ text: '[{"label":"RIZ","quantity":1,"kind":"PRODUCT"}]' }] }, finishReason: 'STOP' }], usageMetadata: usage }],
    ];
    for (const [name, body] of cases) {
      http.reset();
      http.on('generateContent', () => json(body));
      const error = await reader.read(FILE, 'image/jpeg').catch((e: unknown) => e);
      expect(error, name).toBeInstanceOf(ReceiptReadError);
      expect((error as ReceiptReadError).costCents, name).toBeGreaterThan(0);
    }
  });

  it('un échec sans réponse facturée ne porte aucun coût', async () => {
    http.on('generateContent', () => json({}, 500));
    const error = await reader.read(FILE, 'image/jpeg').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(ReceiptReadError);
  });

  it('refuse un texte qui n’est pas du JSON', async () => {
    http.on('generateContent', () => json({ candidates: [{ content: { parts: [{ text: 'désolé' }] }, finishReason: 'STOP' }] }));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toThrow(/exploitable/);
  });

  it('laisse passer tel quel le refus du limiteur Gemini (heure de reprise)', async () => {
    const paused = new GeminiPausedError(new Date(), 'Gemini est en pause : reprise à 14:04.');
    http.on('generateContent', () => Promise.reject(paused));
    await expect(reader.read(FILE, 'image/jpeg')).rejects.toBe(paused);
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
