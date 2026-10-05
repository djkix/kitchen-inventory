// Doublure HTTP pour les tests bout en bout (section 19) : remplace Open Food
// Facts et Gemini dans le montage docker-compose.e2e.yml. Elle rejoue les
// fixtures déjà utilisées par les tests d'intégration d'apps/api
// (apps/api/test/fixtures) sans jamais en recopier le contenu — une réponse
// qui diverge entre les deux suites ne prouverait rien.
//
// Syntaxe volontairement limitée aux formes TypeScript « erasable » (pas
// d'enum, pas de namespace, pas de propriété de paramètre) : le service
// « stub » du montage lance ce fichier directement avec
// `node --experimental-strip-types`, sans étape de compilation ni dépendance
// à installer dans son conteneur.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Les fixtures appartiennent à apps/api ; la doublure les lit à la source.
const FIXTURES_DIR = resolve(HERE, '../../apps/api/test/fixtures');

const DEFAULT_PORT = 3101;

// En-tête qui force le code de statut donné sur n'importe quelle route, pour
// rejouer une panne à la demande plutôt que de prévoir un chemin par panne.
const FORCE_STATUS_HEADER = 'x-stub-force-status';

interface OffMapping {
  readonly file: string;
  readonly status: number;
}

// Correspondance code-barres → fixture, reprise de recognition.e2e-spec.ts :
// la doublure ne fait qu'exposer sur HTTP ce que ces tests tiennent déjà en
// mémoire.
const OFF_BARCODES: Record<string, OffMapping> = {
  '3017620422003': { file: 'off-3017620422003.json', status: 200 },
  '8801043015608': { file: 'off-8801043015608.json', status: 200 },
};
const OFF_NOT_FOUND: OffMapping = { file: 'off-not-found.json', status: 404 };

const VISION_FIXTURE = 'vision-gochujang.json';
const SUGGESTIONS_FIXTURE = 'suggestions/gemini-batch.json';

async function readFixture(file: string): Promise<string> {
  return readFile(resolve(FIXTURES_DIR, file), 'utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Écrit le contenu d'une fixture tel quel : c'est déjà du JSON valide, inutile de le reparser. */
function sendRawJson(res: ServerResponse, status: number, rawBody: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(rawBody);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Enveloppe le contenu brut d'une fixture dans la forme de réponse
 * `generateContent` de Gemini — la même enveloppe que `geminiFixture()` dans
 * apps/api/test/fake-http.ts, pour que les deux suites de tests exercent
 * exactement le même texte de fixture.
 */
function wrapGeminiText(text: string): unknown {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 70, totalTokenCount: 970 },
    modelVersion: 'gemini-3.5-flash',
  };
}

interface GeminiRequestBody {
  tools?: unknown[];
  contents?: Array<{ parts?: Array<{ inlineData?: unknown }> }>;
}

/**
 * Les deux usages de Gemini (reconnaissance photo et suggestions de recettes)
 * arrivent sur la même route `generateContent` ; on les distingue par le
 * corps de la requête, jamais par un ordre d'appel supposé :
 *  - les suggestions portent l'outil `google_search` (GeminiSuggestionProvider
 *    — vigilance 1 : cet outil et `responseSchema` sont mutuellement
 *    exclusifs côté API Gemini, donc seul cet appel porte `tools`) ;
 *  - la reconnaissance photo porte une image en `inlineData` dans les parts
 *    (GeminiProvider), jamais d'outil.
 * ATTENTION si l'un des deux fournisseurs change de forme de requête : ce
 * commentaire décrit l'état actuel des deux clients
 * (apps/api/src/recognition/providers/gemini.provider.ts et
 * apps/api/src/suggestions/gemini-suggestion.provider.ts), pas une règle
 * générale de l'API Gemini — une divergence future doit être répercutée ici.
 */
function isSuggestionRequest(body: GeminiRequestBody): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

function isVisionRequest(body: GeminiRequestBody): boolean {
  return (body.contents ?? []).some((c) => (c.parts ?? []).some((p) => p.inlineData !== undefined));
}

async function handleGenerateContent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readRequestBody(req);
  let body: GeminiRequestBody;
  try {
    body = raw ? (JSON.parse(raw) as GeminiRequestBody) : {};
  } catch {
    sendJson(res, 400, { error: 'corps JSON invalide' });
    return;
  }
  if (isSuggestionRequest(body)) {
    const text = await readFixture(SUGGESTIONS_FIXTURE);
    sendRawJson(res, 200, JSON.stringify(wrapGeminiText(text)));
    return;
  }
  if (isVisionRequest(body)) {
    const text = await readFixture(VISION_FIXTURE);
    sendRawJson(res, 200, JSON.stringify(wrapGeminiText(text)));
    return;
  }
  sendJson(res, 400, { error: 'requête Gemini non reconnue par la doublure : ni outil de recherche, ni image' });
}

async function handleOffLookup(barcode: string, res: ServerResponse): Promise<void> {
  const mapping = OFF_BARCODES[barcode] ?? OFF_NOT_FOUND;
  const text = await readFixture(mapping.file);
  sendRawJson(res, mapping.status, text);
}

export function createStubServer() {
  return createServer((req, res) => {
    void (async () => {
      try {
        const forced = req.headers[FORCE_STATUS_HEADER];
        if (forced) {
          const status = Number(Array.isArray(forced) ? forced[0] : forced);
          sendJson(res, Number.isFinite(status) ? status : 500, { error: `panne simulée demandée via ${FORCE_STATUS_HEADER}` });
          return;
        }

        const url = new URL(req.url ?? '/', 'http://stub.local');

        if (url.pathname === '/healthz' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }

        const offMatch = /^\/api\/v2\/product\/([^/]+)$/.exec(url.pathname);
        if (offMatch && req.method === 'GET') {
          await handleOffLookup(decodeURIComponent(offMatch[1] ?? ''), res);
          return;
        }

        if (/^\/v1beta\/models\/[^/]+:generateContent$/.test(url.pathname) && req.method === 'POST') {
          await handleGenerateContent(req, res);
          return;
        }

        sendJson(res, 404, { error: `route non doublée : ${req.method ?? ''} ${url.pathname}` });
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
}

export async function startStubServer(port = DEFAULT_PORT): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = createStubServer();
  await new Promise<void>((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolveStart());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

// Lancé directement (conteneur « stub » du montage e2e) : écoute sur le port
// de l'environnement, par défaut celui publié par docker-compose.e2e.yml.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  void startStubServer(port).then(({ url }) => {
    // eslint-disable-next-line no-console -- doublure autonome, pas de logger partagé avec apps/api
    console.log(`Doublure Open Food Facts / Gemini à l'écoute sur ${url}`);
  });
}
