import { request, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Options d'une requête sortante. `pinnedAddress` est la seule extension :
 * l'adresse IP déjà validée par l'appelant, sur laquelle la connexion est
 * **épinglée**. Sans elle, `fetch` résoudrait le nom une seconde fois au
 * moment de se connecter — et un DNS complaisant (« DNS rebinding ») pourrait
 * alors rendre une adresse interne après avoir montré une adresse publique à
 * la vérification (revue de sécurité du 2026-10-22).
 */
export interface HttpRequestInit extends RequestInit {
  pinnedAddress?: string;
}

/**
 * Client HTTP injectable : `fetch` en production, un faux qui rejoue des
 * fixtures en test. Aucun test ne doit ouvrir de connexion réseau (section 19).
 */
export type HttpClient = (url: string, init?: HttpRequestInit) => Promise<Response>;
export const HTTP_CLIENT = Symbol('HTTP_CLIENT');
export const defaultHttpClient: HttpClient = (url, init) => {
  if (init?.pinnedAddress) return pinnedHttpsFetch(url, init.pinnedAddress, init);
  return fetch(url, init);
};

/**
 * Résolution DNS qui ne résout rien : elle rend toujours `address`, quel que
 * soit le nom demandé. Le nom reste celui de l'URL pour SNI, la vérification
 * du certificat et l'en-tête `Host` ; seule la destination TCP est figée.
 */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  if (family === 0) throw new Error(`Adresse épinglée invalide : ${address}`);
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** Options de `https.request` pour une URL dont la connexion est épinglée sur `address`. */
export function pinnedRequestOptions(url: URL, address: string, headers: Headers): RequestOptions {
  if (url.protocol !== 'https:') throw new Error('Connexion épinglée : seul https est accepté');
  // `URL.hostname` garde les crochets d'une adresse IPv6 littérale.
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const outgoing: Record<string, string> = {};
  headers.forEach((value, key) => {
    outgoing[key] = value;
  });
  // Le corps est lu tel quel, sans décompression : demander une réponse brute.
  outgoing['accept-encoding'] = 'identity';
  return {
    protocol: 'https:',
    hostname,
    port: url.port ? Number(url.port) : 443,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: outgoing,
    // SNI interdit sur une adresse IP littérale (RFC 6066).
    servername: isIP(hostname) ? undefined : hostname,
    lookup: pinnedLookup(address),
    // Aucun agent partagé : une connexion gardée ouverte vers une autre
    // adresse ne doit jamais être réutilisée pour cette requête.
    agent: false,
  };
}

/**
 * GET HTTPS dont la connexion TCP vise `address` et rien d'autre. Ne suit
 * aucune redirection : l'appelant revalide chaque saut avant de le suivre.
 */
export function pinnedHttpsFetch(rawUrl: string, address: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let options: RequestOptions;
    try {
      options = pinnedRequestOptions(new URL(rawUrl), address, new Headers(init.headers));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const req = request({ ...options, signal: init.signal ?? undefined }, (res) => {
      const headers = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
      const status = res.statusCode ?? 502;
      const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
      if (empty) res.resume();
      const body = empty ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
      resolve(new Response(body, { status, statusText: res.statusMessage, headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
