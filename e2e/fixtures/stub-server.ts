// Doublure HTTP pour les tests bout en bout (section 19) : remplace Open Food
// Facts, Gemini et **les clés de signature de Google** dans le montage
// docker-compose.e2e.yml. Elle rejoue les
// fixtures déjà utilisées par les tests d'intégration d'apps/api
// (apps/api/test/fixtures) sans jamais en recopier le contenu — une réponse
// qui diverge entre les deux suites ne prouverait rien.
//
// Syntaxe volontairement limitée aux formes TypeScript « erasable » (pas
// d'enum, pas de namespace, pas de propriété de paramètre) : le service
// « stub » du montage lance ce fichier directement avec
// `node --experimental-strip-types`, sans étape de compilation ni dépendance
// à installer dans son conteneur.

import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Les fixtures appartiennent à apps/api ; la doublure les lit à la source.
const FIXTURES_DIR = resolve(HERE, '../../apps/api/test/fixtures');

const DEFAULT_PORT = 3101;

// ------------------------------------------------------------- Google (D1–D7)
//
// Les parcours doivent se connecter par le vrai chemin — `POST /auth/google`,
// vérification complète du jeton par `google-auth-library` — sans jamais
// toucher au réseau. On ne double donc PAS la vérification : on double la
// seule chose qu'elle va chercher dehors, les clés publiques de signature.
// `GOOGLE_CERTS_URL` (apps/api/src/common/config.ts) pointe l'application ici,
// et `/__google/token` frappe des jetons signés par la clé privée
// correspondante. Signature RS256, émetteur, audience et expiration sont
// vérifiés pour de bon.
//
// Paire de clés tirée au démarrage : elle ne sort jamais de ce conteneur
// jetable, et rien ne la réutilise d'une exécution à l'autre.
const GOOGLE_KEY_ID = 'e2e';
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const googleKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Jeton d'identité signé pour une adresse. Le `sub` dérive de l'adresse plutôt
 * que d'être tiré au hasard : il doit rester le même d'une connexion à
 * l'autre, sans quoi le contrôle de discordance de `sub` (D10) refuserait la
 * seconde connexion de la même personne.
 */
function mintGoogleCredential(email: string, name: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: GOOGLE_KEY_ID, typ: 'JWT' };
  const payload = {
    iss: GOOGLE_ISSUER,
    aud: GOOGLE_CLIENT_ID,
    sub: createHash('sha256').update(email).digest('hex').slice(0, 21),
    email,
    email_verified: true,
    name,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(googleKeys.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

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
// Ticket de caisse (EF-29) : deux produits suivis en pièces, que le jeu de
// développement connaît (« Yaourt nature », « Beurre doux »). Le rapprochement
// n'accepte « reconnu d'office » que pour une unité PIECE, d'où ce choix plutôt
// que la fixture riz/lait des tests d'API, qui donnerait deux lignes ambiguës.
const RECEIPT_FIXTURE = 'receipts/gemini-ticket-pieces.json';

/**
 * Appels réellement servis sur `generateContent`, par usage. Exposés sur
 * `/__calls` (section 19, lot du 2026-10-15) : depuis le réservoir permanent,
 * un parcours doit pouvoir prouver qu'une visite n'a RIEN demandé au modèle.
 * Compter ici, au seul endroit qui voit passer les requêtes, plutôt que de se
 * fier au `fromCache` que le serveur se pose à lui-même — c'est précisément
 * ce drapeau que le parcours est censé mettre à l'épreuve.
 */
const callCounts = { suggestions: 0, vision: 0, receipts: 0 };

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
  systemInstruction?: { parts?: Array<{ text?: string }> };
  contents?: Array<{ parts?: Array<{ inlineData?: unknown }> }>;
}

/**
 * La lecture d'un ticket porte elle aussi une image (ou un PDF) en
 * `inlineData` : elle ressemble à la reconnaissance photo. Ce qui la distingue
 * est sa consigne (« ticket de caisse », GeminiReceiptReader) — plus son
 * `responseSchema`, retiré le 2026-10-22 (Google refuse en 400 un schéma
 * imbriqué). Elle doit donc être testée AVANT `isVisionRequest`.
 */
function isReceiptRequest(body: GeminiRequestBody): boolean {
  const instruction = (body.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
  return isVisionRequest(body) && instruction.includes('ticket de caisse');
}

/**
 * Les trois usages de Gemini (reconnaissance photo, ticket de caisse et suggestions de recettes)
 * arrivent sur la même route `generateContent` ; on les distingue par le
 * corps de la requête, jamais par un ordre d'appel supposé :
 *  - la reconnaissance photo porte une image en `inlineData` dans les parts
 *    (GeminiProvider), jamais d'outil ;
 *  - tout le reste vient du module recettes.
 *
 * Le critère était auparavant la présence de l'outil `google_search`. Il est
 * tombé le 2026-10-19, quand la recherche web est passée éteinte par défaut :
 * une suggestion sans recherche ne porte plus `tools`, la doublure ne la
 * reconnaissait plus, et les six parcours P5 ont échoué d'un coup. Le commentaire
 * d'origine avertissait déjà qu'un changement de forme de requête devait être
 * répercuté ici — il l'a été trop tard. L'image est le seul signal qui ne
 * dépend d'aucun réglage : on route donc sur elle, et le reste est du module
 * recettes, avec ou sans outil.
 */
function isSuggestionRequest(body: GeminiRequestBody): boolean {
  return !isVisionRequest(body);
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
  if (isReceiptRequest(body)) {
    callCounts.receipts += 1;
    const text = await readFixture(RECEIPT_FIXTURE);
    sendRawJson(res, 200, JSON.stringify(wrapGeminiText(text)));
    return;
  }
  if (isSuggestionRequest(body)) {
    callCounts.suggestions += 1;
    const text = await readFixture(SUGGESTIONS_FIXTURE);
    sendRawJson(res, 200, JSON.stringify(wrapGeminiText(text)));
    return;
  }
  if (isVisionRequest(body)) {
    callCounts.vision += 1;
    const text = await readFixture(VISION_FIXTURE);
    sendRawJson(res, 200, JSON.stringify(wrapGeminiText(text)));
    return;
  }
  sendJson(res, 400, { error: 'requête Gemini non reconnue par la doublure' });
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

        // Clés publiques de signature, à l'emplacement que
        // `GOOGLE_CERTS_URL` donne à l'application. Format PEM indexé par
        // `kid`, celui que `google-auth-library` lit côté Node.
        if (url.pathname === '/oauth2/v1/certs' && req.method === 'GET') {
          sendJson(res, 200, { [GOOGLE_KEY_ID]: googleKeys.publicKey });
          return;
        }

        // Frappe d'un jeton d'identité, lue par les parcours depuis le runner
        // (e2e/support/auth.ts), jamais par l'application. Deux soulignés en
        // tête, comme `/__calls`.
        if (url.pathname === '/__google/token' && req.method === 'GET') {
          const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
          if (!email) {
            sendJson(res, 400, { error: 'paramètre « email » attendu' });
            return;
          }
          sendJson(res, 200, { credential: mintGoogleCredential(email, url.searchParams.get('name') ?? email) });
          return;
        }

        if (url.pathname === '/healthz' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }

        // Compteur d'appels servis (`callCounts`) : lu par les parcours depuis
        // le runner, jamais par l'application. Deux soulignés en tête pour
        // qu'aucune route doublée ne puisse le recouvrir.
        if (url.pathname === '/__calls' && req.method === 'GET') {
          sendJson(res, 200, callCounts);
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
