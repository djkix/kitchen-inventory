import { API_BASE, api, newClientOpId, type ApiClientError } from './api';
import type { AiRequestStatusDto } from '@kitchen/shared';

/**
 * Demandes au modèle qui survivent à l'écran (conception du 2026-11-02).
 *
 * Trois gestes côté téléphone : engendrer un identifiant avant de demander,
 * dire au serveur qu'on a posé le téléphone, et réclamer le résultat au retour.
 */

const PENDING_KEY = 'kitchen.aiRequests';

/**
 * Identifiant d'une demande. Engendré ici et non par le serveur : la page doit
 * pouvoir réclamer son résultat même si elle n'a jamais reçu la réponse.
 */
export function beginAiRequest(): string {
  const id = newClientOpId();
  remember(id);
  return id;
}

/**
 * Signale au serveur que la page passe en arrière-plan pendant que la demande
 * tourne — c'est le « j'ai posé mon téléphone » qui décide s'il faudra
 * annoncer le résultat.
 *
 * `sendBeacon` et non `fetch` : le système gèle la page aussitôt après, et une
 * requête ordinaire serait abandonnée en vol. Rend la fonction qui arrête de
 * surveiller, à appeler dès que la demande a rendu quelque chose.
 */
export function watchAiRequest(id: string): () => void {
  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    navigator.sendBeacon?.(`${API_BASE}/ai-requests/${id}/background`);
  };
  document.addEventListener('visibilitychange', onHidden);
  return () => document.removeEventListener('visibilitychange', onHidden);
}

/** Oublie une demande dont on a vu le résultat : elle n'est plus à réclamer. */
export function forgetAiRequest(id: string): void {
  write(read().filter((pending) => pending !== id));
}

/**
 * Au retour sur l'application : le résultat des demandes qu'on n'a pas vues
 * aboutir. Une demande encore en cours ou différée est gardée pour la fois
 * suivante ; tout le reste est oublié.
 */
export async function recoverAiRequests(): Promise<AiRequestStatusDto[]> {
  const pending = read();
  if (pending.length === 0) return [];
  const found: AiRequestStatusDto[] = [];
  for (const id of pending) {
    try {
      const status = await api.get<AiRequestStatusDto>(`/ai-requests/${id}`);
      if (status.state === 'RUNNING' || status.state === 'DEFERRED') continue;
      forgetAiRequest(id);
      found.push(status);
    } catch {
      // Introuvable, session expirée, réseau coupé : on n'insiste pas, et on
      // n'encombre pas la liste indéfiniment.
      forgetAiRequest(id);
    }
  }
  return found;
}

/** Vrai quand le refus dit que la demande est gardée et repartira seule. */
export function isDeferred(error: unknown): error is ApiClientError & { details: { retryAt: string } } {
  const details = (error as { details?: { deferred?: unknown } } | null)?.details;
  return details?.deferred === true;
}

/** Instant de reprise annoncé par un refus différé. */
export function deferredRetryAt(error: unknown): Date | null {
  const raw = (error as { details?: { retryAt?: unknown } } | null)?.details?.retryAt;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Les identifiants en attente survivent à une fermeture de l'application. */
function read(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(ids.slice(-10)));
  } catch {
    // Mode privé, stockage plein : la récupération au retour ne marchera pas,
    // ce qui n'empêche ni la demande, ni la notification.
  }
}

function remember(id: string): void {
  write([...read().filter((pending) => pending !== id), id]);
}
