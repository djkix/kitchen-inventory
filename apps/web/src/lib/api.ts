import { apiErrorSchema, type ErrorCode } from '@kitchen/shared';

export const API_BASE = '/api/v1';

/** Écrans accessibles sans session : un 401 n'y déclenche pas de redirection. */
const AUTH_PATHS = ['/connexion', '/installation'];

export type ClientErrorCode = ErrorCode | 'network' | 'unknown';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ClientErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** Lecture typée et tolérante d'un champ de `details` (objet plat renvoyé par l'API). */
  detail<T = unknown>(key: string): T | undefined {
    if (typeof this.details !== 'object' || this.details === null) return undefined;
    return (this.details as Record<string, unknown>)[key] as T | undefined;
  }
}

export function isApiError(error: unknown, code?: ClientErrorCode): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Corps multipart déjà construit ; le `Content-Type` est alors laissé au navigateur. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Vrai pour les appels qui sondent la session (`/me`) : un 401 est une réponse, pas une expulsion. */
  skipAuthRedirect?: boolean;
}

let redirectHandler: (target: string) => void = (target) => {
  window.location.assign(target);
};

/** Permet à l'application d'utiliser la navigation du routeur plutôt qu'un rechargement complet. */
export function setUnauthenticatedHandler(handler: (target: string) => void): void {
  redirectHandler = handler;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Convertit une réponse HTTP en erreur cliente, en lisant l'enveloppe `{error:{code,message,details}}` si présente. */
export async function toClientError(response: Response): Promise<ApiClientError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiClientError(response.status, code, message, details);
  }
  return new ApiClientError(response.status, 'unknown', defaultMessage(response.status));
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Session absente ou expirée';
  if (status === 403) return 'Action interdite';
  if (status === 404) return 'Ressource introuvable';
  if (status === 413) return 'Fichier trop volumineux';
  if (status === 429) return 'Trop de requêtes, réessayez dans un instant';
  if (status === 503) return 'Service indisponible : l’application démarre ou est en maintenance';
  if (status >= 500) return 'Erreur du serveur, réessayez dans un instant';
  return 'Requête refusée';
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), { method, headers, body, credentials: 'include', signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'network', 'Connexion au serveur impossible. Vérifiez le réseau, puis réessayez.');
  }

  if (!response.ok) {
    const clientError = await toClientError(response);
    if (clientError.status === 401 && !options.skipAuthRedirect && !AUTH_PATHS.includes(window.location.pathname)) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      redirectHandler(`/connexion?next=${next}`);
    }
    throw clientError;
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  postForm: <T>(path: string, formData: FormData, options?: RequestOptions) => request<T>('POST', path, { ...options, formData }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('DELETE', path, { ...options, body }),
};

/** URL d'un média servi derrière la session (`GET /api/v1/media/<chemin>`). */
export function mediaUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return `${API_BASE}/media/${imagePath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Identifiant d'opération pour l'idempotence des écritures de stock (section 8). */
export function newClientOpId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Message affichable pour n'importe quelle erreur attrapée. */
export function errorMessage(error: unknown, fallback = 'Une erreur est survenue'): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
