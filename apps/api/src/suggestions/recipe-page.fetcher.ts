import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { HttpClient } from '../common/http-client.js';

/** Recette lue depuis `schema.org/Recipe` (tâche 9, B6, B14) : juste assez pour nourrir la réécriture. */
export interface PageRecipe {
  title: string | null;
  ingredients: string[];
  steps: string[];
}

/** Borne haute de la page récupérée (vigilance « cap the response size ») : une page de recette tient largement dedans. */
const MAX_BODY_BYTES = 2_000_000;
/** Nombre de sauts de redirection suivis au maximum ; au-delà, la page est traitée comme injoignable. */
const MAX_REDIRECTS = 5;
/** Plafond par défaut (« a five-second ceiling ») ; surchargeable en test pour ne pas attendre cinq secondes pour de vrai. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** Borne du texte nettoyé envoyé à Gemini en l'absence de données structurées : un prompt, pas la page entière. */
const MAX_TEXT_CHARS = 8_000;

/**
 * Refus de sécurité (HTTPS exigé, hôte privé ou local) : jamais une tentative
 * silencieuse. Distingué d'un simple `null` (page injoignable ou sans recette
 * exploitable), qui lui ne doit jamais faire échouer l'appelant.
 */
export class RecipePageRefusedError extends Error {}

const LD_JSON_RE = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => toStringArray(entry));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return [record.text];
    if (Array.isArray(record.itemListElement)) return toStringArray(record.itemListElement);
  }
  return [];
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

/** Aplatit un bloc JSON-LD (objet, tableau, ou `@graph` imbriqué) en liste de nœuds candidats. */
function flattenJsonLdNodes(value: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      nodes.push(record);
      if (record['@graph'] !== undefined) visit(record['@graph']);
    }
  };
  visit(value);
  return nodes;
}

function extractRecipeNode(node: Record<string, unknown>): PageRecipe | null {
  const title = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : null;
  const ingredients = toStringArray(node.recipeIngredient)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const steps = toStringArray(node.recipeInstructions)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ingredients.length === 0 && steps.length === 0) return null;
  return { title, ingredients, steps };
}

/** Lecture pure de `schema.org/Recipe` (vigilance 5) : un objet simple, imbriqué dans `@graph`, ou dans un tableau JSON-LD. */
export function extractPageRecipe(html: string): PageRecipe | null {
  for (const match of html.matchAll(LD_JSON_RE)) {
    const raw = match[1];
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // Un bloc JSON-LD illisible n'empêche pas d'en lire un autre sur la même page.
      continue;
    }
    for (const node of flattenJsonLdNodes(parsed)) {
      if (!isRecipeNode(node)) continue;
      const recipe = extractRecipeNode(node);
      if (recipe) return recipe;
    }
  }
  return null;
}

/** Nettoie une page HTML en texte brut, à soumettre à Gemini quand aucune donnée structurée n'est exploitable. */
export function cleanPageText(html: string): string {
  const withoutNoise = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutNoise.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c, d] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF Protocol Assignments (RFC 6890)
  if (a === 198 && (b === 18 || b === 19)) return true; // tests de débit (RFC 2544)
  if (a === 100 && b >= 64 && b <= 127) return true; // plage partagée CGNAT (RFC 6598)
  if (a >= 224 && a <= 239) return true; // multicast (RFC 5771)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // diffusion limitée
  return false;
}

/**
 * Les huit groupes de 16 bits d'une adresse IPv6, « :: » développé et IPv4
 * finale (`::ffff:1.2.3.4`) convertie ; `null` si l'adresse est illisible.
 */
export function parseIPv6(address: string): number[] | null {
  let text = (address.split('%')[0] ?? '').toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const parts = dotted[2].split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    const [a, b, c, d] = parts as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const groups = part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN));
    return groups.some((g) => Number.isNaN(g)) ? null : groups;
  };
  const head = toGroups(halves[0]);
  const tail = toGroups(halves[1]);
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isPrivateIPv6(address: string): boolean {
  const g = parseIPv6(address);
  if (!g) return true; // illisible : refusée par prudence
  const [g0, g1, g2, g3, g4, g5] = g as [number, number, number, number, number, number, number, number];
  const zeroUpTo = (n: number): boolean => g.slice(0, n).every((x) => x === 0);
  // Non spécifiée (::), bouclage (::1) et IPv4-compatible (::a.b.c.d, dépréciée) :
  // les 96 premiers bits sont nuls.
  if (zeroUpTo(6)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) et IPv4-translated (::ffff:0:a.b.c.d, RFC 2765) :
  // refusées en bloc, une réponse DNS légitime n'en rend pas.
  if (zeroUpTo(5) && g5 === 0xffff) return true;
  if (zeroUpTo(4) && g4 === 0xffff && g5 === 0) return true;
  // NAT64 (64:ff9b::/96, RFC 6052, et 64:ff9b:1::/48, RFC 8215) : l'adresse
  // IPv4 encapsulée peut être interne.
  if (g0 === 0x64 && g1 === 0xff9b && (g2 === 0 || g2 === 1)) return true;
  // 6to4 (2002::/16) et Teredo (2001::/32) : IPv4 encapsulée, elle aussi.
  if (g0 === 0x2002) return true;
  if (g0 === 0x2001 && g1 === 0) return true;
  // Préfixe de rejet (100::/64, RFC 6666).
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true; // adresses locales uniques, fc00::/7
  if (g0 >= 0xfe80 && g0 <= 0xfeff) return true; // lien-local fe80::/10 et site-local déprécié fec0::/10
  if (g0 >= 0xff00) return true; // multicast, ff00::/8
  return false;
}

/** Vrai pour toute adresse qui n'est pas publiquement routable — ou illisible. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // adresse non reconnue : refusée par prudence, jamais laissée passer
}

/**
 * Lecteur de page des recettes web, utilisé uniquement à l'ingestion dans le
 * réservoir (D9, D10) : la page est lue une seule fois, son contenu recopié en
 * base, et le site n'est plus jamais recontacté — pas même à la conservation.
 * HTTPS seul, délai borné, hôtes privés ou locaux refusés, taille plafonnée,
 * redirections revalidées à chaque saut, et connexion **épinglée** sur
 * l'adresse validée (`pinnedAddress`) : le nom n'est jamais résolu une
 * seconde fois au moment de se connecter, ce qui ferme la porte au « DNS
 * rebinding » (revue de sécurité du 2026-10-22). Un échec de sécurité est un refus
 * explicite (`RecipePageRefusedError`) ; un échec réseau rend `null`, sans
 * jamais faire échouer l'appelant.
 */
export class RecipePageFetcher {
  constructor(
    private readonly http: HttpClient,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    // Injectable pour les tests : aucun test ne résout de nom pour de vrai.
    private readonly resolveHost: HostResolver = resolveWithDns,
  ) {}

  /**
   * Récupère la page une seule fois et en tire les deux lectures possibles
   * (revue de tâche 9 : la page ne doit pas être récupérée deux fois — une
   * pour chercher `schema.org/Recipe`, une autre pour le repli en texte —
   * alors qu'un seul GET donne déjà tout ce qu'il faut pour les deux).
   */
  async fetchContent(url: string): Promise<{ structured: PageRecipe | null; text: string } | null> {
    const html = await this.fetchHtml(url);
    if (html === null) return null;
    return { structured: extractPageRecipe(html), text: cleanPageText(html) };
  }

  private async fetchHtml(rawUrl: string): Promise<string | null> {
    let current: URL;
    try {
      current = new URL(rawUrl);
    } catch {
      throw new RecipePageRefusedError('Lien de la recette invalide');
    }

    // Un seul délai pour toute la chaîne de redirection (vigilance « a five-second
    // ceiling ») : un délai par saut porterait le pire cas à `timeoutMs * MAX_REDIRECTS`,
    // bien au-delà de ce que le brief promet.
    const signal = AbortSignal.timeout(this.timeoutMs);

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Revalidé à chaque saut, et l'adresse retenue est celle-là même sur
        // laquelle la connexion part.
        const pinnedAddress = await assertFetchable(current, this.resolveHost);

        const response = await this.http(current.toString(), {
          redirect: 'manual',
          headers: { accept: 'text/html,application/xhtml+xml' },
          signal,
          pinnedAddress,
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) return null;
          current = new URL(location, current);
          continue;
        }
        if (!response.ok) return null;
        return await this.readBodyCapped(response, signal);
      }
      return null; // trop de sauts de redirection
    } catch (error) {
      if (error instanceof RecipePageRefusedError) throw error;
      // Réseau injoignable, délai dépassé — y compris pendant la lecture du
      // corps, un flux qui démarre puis se bloque (revue de tâche 9 : ce
      // `readBodyCapped` vivait hors de ce `try`, laissant un `AbortError`
      // tardif s'échapper en 500) —, ou URL de redirection invalide : échec
      // doux, jamais une exception qui remonte à l'appelant.
      return null;
    }
  }

  private async readBodyCapped(response: Response, signal: AbortSignal): Promise<string | null> {
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > MAX_BODY_BYTES) return null;
    if (!response.body) {
      const text = await response.text();
      return text.length > MAX_BODY_BYTES ? null : text;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      // Course explicite contre le même délai que le reste de la chaîne : un
      // corps qui démarre (en-têtes reçus) puis se bloque doit rendre `null`
      // comme n'importe quel autre dépassement, pas seulement quand
      // l'environnement d'exécution lie lui-même le flux au signal (revue de
      // tâche 9, Important 1).
      const outcome = await raceWithAbort(reader.read(), signal);
      if (outcome === 'aborted') {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      const { done, value } = outcome;
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }
}

/** Résout `'aborted'` dès que `signal` s'abandonne, sans jamais attendre que `promise` se règle elle-même. */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | 'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted');
  return new Promise<T | 'aborted'>((resolve, reject) => {
    const onAbort = (): void => resolve('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Résout un nom d'hôte en adresses IP (toutes familles). */
export type HostResolver = (hostname: string) => Promise<string[]>;

async function resolveWithDns(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/**
 * Refuse tout ce qui n'est pas HTTPS vers un hôte public (vigilance 2) ; jamais
 * suivi en silence. Rend l'adresse sur laquelle épingler la connexion.
 */
async function assertFetchable(url: URL, resolveHost: HostResolver): Promise<string> {
  if (url.protocol !== 'https:') {
    throw new RecipePageRefusedError('Seule une adresse en https est acceptée pour récupérer une recette');
  }
  return assertPublicHost(url.hostname.replace(/^\[(.*)\]$/, '$1'), resolveHost);
}

async function assertPublicHost(hostname: string, resolveHost: HostResolver): Promise<string> {
  const literalVersion = isIP(hostname);
  const addresses: string[] = [];
  if (literalVersion) {
    addresses.push(hostname);
  } else {
    try {
      addresses.push(...(await resolveHost(hostname)));
    } catch {
      throw new RecipePageRefusedError('Hôte de la recette introuvable');
    }
  }
  // Toutes les adresses doivent être publiques, pas seulement celle retenue :
  // un nom qui en mélange est suspect en soi.
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw new RecipePageRefusedError('Adresse privée ou locale refusée pour récupérer une recette');
  }
  return addresses[0]!;
}
