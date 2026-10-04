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
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // plage partagée CGNAT (RFC 6598)
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // adresse non reconnue : refusée par prudence, jamais laissée passer
}

/**
 * Récupérateur de page pour la conservation d'une suggestion web (tâche 9,
 * B6) : HTTPS seul, délai borné, hôtes privés ou locaux refusés, taille
 * plafonnée, redirections revalidées à chaque saut. Un échec de sécurité est
 * un refus explicite (`RecipePageRefusedError`) ; un échec réseau ou
 * l'absence de recette exploitable rend `null`, sans jamais faire échouer
 * l'appelant.
 */
export class RecipePageFetcher {
  constructor(
    private readonly http: HttpClient,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Lit `schema.org/Recipe` sur la page ; `null` si absent, non conforme, ou si la page ne répond pas à temps. */
  async fetch(url: string): Promise<PageRecipe | null> {
    const html = await this.fetchHtml(url);
    if (html === null) return null;
    return extractPageRecipe(html);
  }

  /** Texte nettoyé de la page, pour la réécriture quand aucune donnée structurée n'est exploitable. */
  async fetchText(url: string): Promise<string | null> {
    const html = await this.fetchHtml(url);
    if (html === null) return null;
    const text = cleanPageText(html);
    return text.length > 0 ? text : null;
  }

  private async fetchHtml(rawUrl: string): Promise<string | null> {
    let current: URL;
    try {
      current = new URL(rawUrl);
    } catch {
      throw new RecipePageRefusedError('Lien de la recette invalide');
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertFetchable(current);

      let response: Response;
      try {
        response = await this.http(current.toString(), {
          redirect: 'manual',
          headers: { accept: 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        // Réseau injoignable ou délai dépassé : échec doux, jamais une exception qui remonte.
        return null;
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        try {
          current = new URL(location, current);
        } catch {
          return null;
        }
        continue;
      }
      if (!response.ok) return null;
      return this.readBodyCapped(response);
    }
    return null; // trop de sauts de redirection
  }

  private async readBodyCapped(response: Response): Promise<string | null> {
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
      const { done, value } = await reader.read();
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

/** Refuse tout ce qui n'est pas HTTPS vers un hôte public (vigilance 2) ; jamais suivi en silence. */
async function assertFetchable(url: URL): Promise<void> {
  if (url.protocol !== 'https:') {
    throw new RecipePageRefusedError('Seule une adresse en https est acceptée pour récupérer une recette');
  }
  await assertPublicHost(url.hostname);
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literalVersion = isIP(hostname);
  const addresses: string[] = [];
  if (literalVersion) {
    addresses.push(hostname);
  } else {
    try {
      const results = await lookup(hostname, { all: true });
      addresses.push(...results.map((r) => r.address));
    } catch {
      throw new RecipePageRefusedError('Hôte de la recette introuvable');
    }
  }
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw new RecipePageRefusedError('Adresse privée ou locale refusée pour récupérer une recette');
  }
}
