import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp, geminiFixture, json, TINY_PNG } from '../../test/fake-http.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'djkix' };
const geminiText = (lines: unknown, finishReason = 'STOP') =>
  json({
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(lines) }] }, finishReason }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 70, totalTokenCount: 970 },
  });

function setup(overrides: Record<string, string> = {}) {
  const ctx = {} as { t: TestApp; agent: TestAgent; http: FakeHttp; locationId: string };
  beforeAll(async () => {
    ctx.http = new FakeHttp();
    ctx.t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'test-key', ...overrides }, ctx.http.client);
  });
  beforeEach(async () => {
    await ctx.t.reset();
    ctx.http.reset();
    ctx.agent = ctx.t.agent();
    await ctx.t.signIn(ctx.agent, ADMIN);
    ctx.locationId = (await ctx.t.prisma.location.findFirstOrThrow()).id;
  });
  afterAll(() => ctx.t.close());
  const upload = (mime = 'image/png', locationId = ctx.locationId) =>
    ctx.agent.post('/api/v1/receipts').attach('file', TINY_PNG, { filename: 'ticket', contentType: mime }).field('locationId', locationId);
  return { ctx, upload };
}

describe('lecture d’un ticket de caisse (EF-29)', () => {
  const { ctx, upload } = setup();

  it('rend les lignes dans l’ordre avec leurs trois états, relisibles par GET', async () => {
    ctx.http.on('generateContent', () =>
      geminiText([
        { label: 'RIZ BASMATI 1KG', quantity: 3, kind: 'PRODUCT' },
        { label: 'SAC CAISSE', quantity: 1, kind: 'OTHER' },
        { label: 'LAIT', quantity: 2, kind: 'PRODUCT' },
        { label: 'XYZZY', quantity: 1, kind: 'PRODUCT' },
      ]),
    );
    const riz = (await ctx.agent.post('/api/v1/products').send({ name: 'Riz basmati' }).expect(201)).body;
    await ctx.agent.post('/api/v1/products').send({ name: 'Lait demi-écrémé' }).expect(201);
    await ctx.agent.post('/api/v1/products').send({ name: 'Lait entier' }).expect(201);
    // Deux lots actifs de dates différentes (sinon `POST /stock` les fusionnerait) : 2 + 1 = 3.
    await ctx.agent.post('/api/v1/stock').send({ productId: riz.id, locationId: ctx.locationId, quantity: 2 }).expect(201);
    await ctx.agent.post('/api/v1/stock').send({ productId: riz.id, locationId: ctx.locationId, quantity: 1, expiryDate: '2030-01-01', dateType: 'USE_BY' }).expect(201);
    // Un lot archivé du même emplacement, directement par Prisma : exclu du total.
    const archived = (await ctx.agent.post('/api/v1/stock').send({ productId: riz.id, locationId: ctx.locationId, quantity: 7, expiryDate: '2030-02-02', dateType: 'USE_BY' }).expect(201)).body;
    await ctx.t.prisma.stockItem.update({ where: { id: (archived.item ?? archived).id }, data: { archivedAt: new Date() } });
    // Un lot du même produit dans un autre emplacement ne compte pas.
    const other = (await ctx.t.prisma.location.findMany()).find((l) => l.id !== ctx.locationId)!;
    await ctx.agent.post('/api/v1/stock').send({ productId: riz.id, locationId: other.id, quantity: 5 }).expect(201);

    const res = await upload().expect(201);
    expect(res.body.locationId).toBe(ctx.locationId);
    expect(res.body.lines.map((l: { rawLabel: string; state: string; position: number }) => [l.position, l.rawLabel, l.state])).toEqual([
      [0, 'RIZ BASMATI 1KG', 'MATCHED'],
      [1, 'LAIT', 'AMBIGUOUS'],
      [2, 'XYZZY', 'UNKNOWN'],
    ]);
    const [matched, ambiguous, unknown] = res.body.lines;
    expect(matched).toMatchObject({ quantity: 3, currentQuantity: 3, product: { id: riz.id } });
    expect(ambiguous.product).toBeNull();
    expect(ambiguous.candidates.map((c: { name: string }) => c.name).sort()).toEqual(['Lait demi-écrémé', 'Lait entier']);
    expect(unknown).toMatchObject({ product: null, candidates: [], currentQuantity: 0 });

    const again = await ctx.agent.get(`/api/v1/receipts/${res.body.id}`).expect(200);
    expect(again.body).toEqual(res.body);
    await ctx.agent.get('/api/v1/receipts/inconnu').expect(404);
  });

  it('un alias appris l’emporte sur la recherche', async () => {
    ctx.http.on('generateContent', () => geminiText([{ label: 'POULET RTI 1KG', quantity: 1, kind: 'PRODUCT' }]));
    const poulet = (await ctx.agent.post('/api/v1/products').send({ name: 'Volaille fermière' }).expect(201)).body;
    const { normalizeReceiptLabel } = await import('@kitchen/shared');
    await ctx.t.prisma.receiptLabelAlias.create({ data: { label: normalizeReceiptLabel('POULET RTI 1KG'), productId: poulet.id } });
    const res = await upload().expect(201);
    expect(res.body.lines[0]).toMatchObject({ state: 'MATCHED', product: { id: poulet.id } });
  });

  it('ne conserve jamais le fichier et journalise l’appel sous RECEIPT avec son coût', async () => {
    ctx.http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload().expect(201);
    expect(await readdir(ctx.t.config.MEDIA_DIR)).toEqual([]);
    const logs = await ctx.t.prisma.recognitionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ purpose: 'RECEIPT', provider: 'gemini', succeeded: true, imagePath: null });
    expect(Number(logs[0]!.costCents)).toBeGreaterThan(0);
    expect(JSON.stringify(logs[0]!.rawResult)).not.toContain(TINY_PNG.toString('base64'));
  });

  it('borne la quantité : un 1e9 halluciné devient 1', async () => {
    ctx.http.on('generateContent', () => geminiText([{ label: 'RIZ', quantity: 1e9, kind: 'PRODUCT' }]));
    const res = await upload().expect(201);
    expect(res.body.lines[0].quantity).toBe(1);
  });

  it('un ticket illisible rend 502 en français et son coût entre au journal', async () => {
    ctx.http.on('generateContent', () => geminiText([], 'STOP'));
    const res = await upload().expect(502);
    expect(res.body.error.message).toMatch(/Aucun produit lisible/);
    const logs = await ctx.t.prisma.recognitionLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ purpose: 'RECEIPT', succeeded: false });
    expect(Number(logs[0]!.costCents)).toBeGreaterThan(0);
    expect(await ctx.t.prisma.receipt.count()).toBe(0);
  });

  it('un fournisseur injoignable rend 502 sans coût', async () => {
    ctx.http.fail('generateContent');
    await upload().expect(502);
    const log = await ctx.t.prisma.recognitionLog.findFirstOrThrow();
    expect(log.costCents).toBeNull();
  });

  it('refuse un format non pris en charge, un fichier absent et un emplacement inconnu', async () => {
    ctx.http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload('text/plain').expect(400);
    await ctx.agent.post('/api/v1/receipts').field('locationId', ctx.locationId).expect(400);
    await upload('image/png', 'inconnu').expect(404);
    await ctx.agent.post('/api/v1/receipts').attach('file', TINY_PNG, { filename: 't.png', contentType: 'image/png' }).expect(400);
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('accepte un PDF', async () => {
    ctx.http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload('application/pdf').expect(201);
    expect(JSON.parse(String(ctx.http.calls[0]!.init?.body)).contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
  });

  it('le plafond mensuel partagé rend 429 sans appeler le fournisseur', async () => {
    await ctx.t.prisma.recognitionLog.create({ data: { provider: 'gemini', purpose: 'VISION', costCents: 500, succeeded: true } });
    const res = await upload().expect(429);
    expect(res.body.error.message).toMatch(/Plafond/);
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('quota journalier de tickets (EF-29)', () => {
  const { ctx, upload } = setup({ RECEIPT_DAILY_QUOTA: '1' });

  it('rend 429 une fois le quota épuisé, sans appeler le fournisseur', async () => {
    ctx.http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload().expect(201);
    const res = await upload().expect(429);
    expect(res.body.error.message).toMatch(/Quota journalier/);
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('les lectures photo ne le consomment pas', async () => {
    await ctx.t.prisma.recognitionLog.create({ data: { provider: 'gemini', purpose: 'VISION', succeeded: true } });
    ctx.http.on('generateContent', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload().expect(201);
  });
});

describe('repli de modèle et fournisseur désactivé (EF-29)', () => {
  const { ctx, upload } = setup({ VISION_MODEL: 'modele-principal', FALLBACK_MODEL: 'modele-repli' });

  it('bascule une fois sur le modèle de repli quand le quota du premier est épuisé', async () => {
    ctx.http.on('modele-principal', () => json({ error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }] } }, 429));
    ctx.http.on('modele-repli', () => geminiFixture('receipts/gemini-ticket.json'));
    await upload().expect(201);
    expect(ctx.http.calls.map((c) => c.url.match(/models\/([^:]+):/)?.[1])).toEqual(['modele-principal', 'modele-repli']);
  });
});

describe('lecture de ticket sans fournisseur (EF-29)', () => {
  const { ctx, upload } = setup({ VISION_PROVIDER: 'none' });

  it('rend 422 provider_disabled', async () => {
    const res = await upload().expect(422);
    expect(res.body.error.code).toBe('provider_disabled');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('validation d’un ticket vers le stock (EF-29)', () => {
  const { ctx, upload } = setup();
  const stockOf = async (productId: string) =>
    (await ctx.t.prisma.stockItem.findMany({ where: { productId, archivedAt: null } })).reduce((n, i) => n + Number(i.quantity), 0);
  const draft = async (labels: string[]) => {
    ctx.http.on('generateContent', () => geminiText(labels.map((label) => ({ label, quantity: 1, kind: 'PRODUCT' }))));
    return (await upload().expect(201)).body as { id: string; lines: { id: string }[] };
  };
  const product = async (name: string) => (await ctx.agent.post('/api/v1/products').send({ name }).expect(201)).body.id as string;
  const validate = (id: string, lines: { id: string; productId: string; quantity: number; clientOpId: string }[]) =>
    ctx.agent.post(`/api/v1/receipts/${id}/validate`).send({ lines });

  it('valide deux lignes cochées et laisse les autres de côté', async () => {
    const riz = await product('Riz basmati');
    const pates = await product('Pâtes penne');
    const lait = await product('Lait entier');
    const r = await draft(['RIZ', 'PATES', 'LAIT']);
    const res = await validate(r.id, [
      { id: r.lines[0]!.id, productId: riz, quantity: 3, clientOpId: 'op-line-a' },
      { id: r.lines[1]!.id, productId: pates, quantity: 2, clientOpId: 'op-line-b' },
    ]).expect(200);
    expect(res.body).toEqual({ added: 2 });
    expect([await stockOf(riz), await stockOf(pates), await stockOf(lait)]).toEqual([3, 2, 0]);
    expect(await ctx.t.prisma.stockMovement.count()).toBe(2);
    const item = await ctx.t.prisma.stockItem.findFirstOrThrow({ where: { productId: riz } });
    expect(item).toMatchObject({ locationId: ctx.locationId, expiryDate: null });
    expect((await ctx.t.prisma.receipt.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('VALIDATED');
  });

  it('rejouer la même validation avec les mêmes clientOpId n’ajoute rien', async () => {
    const riz = await product('Riz basmati');
    const r = await draft(['RIZ']);
    const lines = [{ id: r.lines[0]!.id, productId: riz, quantity: 3, clientOpId: 'op-line-a' }];
    await validate(r.id, lines).expect(200);
    const again = await validate(r.id, lines).expect(200);
    expect(again.body).toEqual({ added: 0 });
    expect(await stockOf(riz)).toBe(3);
    expect(await ctx.t.prisma.stockMovement.count()).toBe(1);
  });

  it('rejoue sans doubler après une validation interrompue (ticket encore DRAFT)', async () => {
    const riz = await product('Riz basmati');
    const pates = await product('Pâtes penne');
    const r = await draft(['RIZ', 'PATES']);
    const lines = [
      { id: r.lines[0]!.id, productId: riz, quantity: 3, clientOpId: 'op-line-a' },
      { id: r.lines[1]!.id, productId: pates, quantity: 2, clientOpId: 'op-line-b' },
    ];
    await validate(r.id, lines.slice(0, 1)).expect(200);
    await ctx.t.prisma.receipt.update({ where: { id: r.id }, data: { status: 'DRAFT' } });
    expect((await validate(r.id, lines).expect(200)).body).toEqual({ added: 1 });
    expect([await stockOf(riz), await stockOf(pates)]).toEqual([3, 2]);
  });

  it('deux lignes du même produit montent la quantité de deux au total', async () => {
    const riz = await product('Riz basmati');
    const r = await draft(['RIZ 1KG', 'RIZ BIO']);
    await validate(r.id, [
      { id: r.lines[0]!.id, productId: riz, quantity: 2, clientOpId: 'op-line-a' },
      { id: r.lines[1]!.id, productId: riz, quantity: 5, clientOpId: 'op-line-b' },
    ]).expect(200);
    expect(await stockOf(riz)).toBe(7);
    expect(await ctx.t.prisma.stockMovement.count()).toBe(2);
  });

  it('une ligne absente du corps n’est pas ajoutée', async () => {
    const riz = await product('Riz basmati');
    const r = await draft(['RIZ', 'XYZZY']);
    await validate(r.id, [{ id: r.lines[0]!.id, productId: riz, quantity: 1, clientOpId: 'op-line-a' }]).expect(200);
    expect(await ctx.t.prisma.stockMovement.count()).toBe(1);
    expect(await ctx.t.prisma.product.count()).toBe(1);
  });

  it('un ticket déjà VALIDATED est refusé pour d’autres opérations', async () => {
    const riz = await product('Riz basmati');
    const r = await draft(['RIZ', 'RIZ BIO']);
    await validate(r.id, [{ id: r.lines[0]!.id, productId: riz, quantity: 1, clientOpId: 'op-line-a' }]).expect(200);
    const res = await validate(r.id, [{ id: r.lines[1]!.id, productId: riz, quantity: 1, clientOpId: 'op-line-b' }]).expect(409);
    expect(res.body.error.message).toMatch(/déjà été validé/);
    expect(await stockOf(riz)).toBe(1);
  });

  it('refuse une ligne d’un autre ticket, un produit inconnu et des doublons', async () => {
    const riz = await product('Riz basmati');
    const r = await draft(['RIZ']);
    const line = r.lines[0]!.id;
    await validate(r.id, [{ id: 'autre', productId: riz, quantity: 1, clientOpId: 'op-line-a' }]).expect(404);
    await validate(r.id, [{ id: line, productId: 'inconnu', quantity: 1, clientOpId: 'op-line-b' }]).expect(404);
    await validate('inconnu', [{ id: line, productId: riz, quantity: 1, clientOpId: 'op-line-c' }]).expect(404);
    await validate(r.id, [
      { id: line, productId: riz, quantity: 1, clientOpId: 'op-line-d' },
      { id: line, productId: riz, quantity: 1, clientOpId: 'op-line-e' },
    ]).expect(400);
    await validate(r.id, []).expect(400);
    expect(await ctx.t.prisma.stockMovement.count()).toBe(0);
  });
});
