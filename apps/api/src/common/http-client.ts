/**
 * Client HTTP injectable : `fetch` en production, un faux qui rejoue des
 * fixtures en test. Aucun test ne doit ouvrir de connexion réseau (section 19).
 */
export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;
export const HTTP_CLIENT = Symbol('HTTP_CLIENT');
export const defaultHttpClient: HttpClient = (url, init) => fetch(url, init);
