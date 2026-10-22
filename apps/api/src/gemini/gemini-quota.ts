import { GeminiQuotaError } from './gemini-errors.js';
import { nextPacificMidnight, pacificDay, resumeAt } from './gemini-time.js';

export interface GeminiLimits {
  rpm: number;
  tpm: number;
  rpd: number;
}

/** Niveau gratuit de Google par modèle, au 2026-10 : réglables par modèle dans Réglages. */
export const DEFAULT_LIMITS: GeminiLimits = { rpm: 5, tpm: 250_000, rpd: 20 };

const WINDOW_MS = 60_000;
const requests = (n: number) => `${n} requête${n > 1 ? 's' : ''}`;
/** Marge ajoutée à la reprise d'une fenêtre glissante : l'horloge de Google n'est pas la nôtre. */
const MARGIN_MS = 1000;

interface ModelState {
  requests: number[];
  tokens: Array<[at: number, tokens: number]>;
  day: string;
  dayRequests: number;
  exhaustedUntil: number;
}

/**
 * Limiteur par modèle, en mémoire : l'API tourne en un seul processus, et
 * vérifier puis réserver sans `await` entre les deux suffit à l'atomicité.
 * Le compteur du jour est rechargé du journal au démarrage (`seed`).
 */
export class GeminiLimiter {
  private readonly states = new Map<string, ModelState>();

  /** Refus à venir pour un appel maintenant, ou `null`. Ne consomme rien. */
  check(model: string, limits: GeminiLimits, now: Date, timeZone?: string): GeminiQuotaError | null {
    const s = this.state(model, now);
    const t = now.getTime();
    if (s.exhaustedUntil > t || s.dayRequests + 1 > limits.rpd) {
      const until = nextPacificMidnight(now);
      return new GeminiQuotaError(until, 'day', `Quota Gemini du jour atteint (${requests(limits.rpd)}) : reprise ${resumeAt(until, now, timeZone)}.`);
    }
    if (s.requests.length + 1 > limits.rpm) {
      const until = new Date(s.requests[0]! + WINDOW_MS + MARGIN_MS);
      return new GeminiQuotaError(until, 'minute', `Limite de ${requests(limits.rpm)} par minute atteinte : reprise ${resumeAt(until, now, timeZone)}.`);
    }
    let sum = s.tokens.reduce((n, [, k]) => n + k, 0);
    if (sum >= limits.tpm) {
      for (const [at, k] of s.tokens) {
        sum -= k;
        if (sum < limits.tpm) {
          const until = new Date(at + WINDOW_MS + MARGIN_MS);
          return new GeminiQuotaError(until, 'tokens', `Limite de jetons par minute atteinte : reprise ${resumeAt(until, now, timeZone)}.`);
        }
      }
    }
    return null;
  }

  /** Prend la place ou lève le refus. */
  reserve(model: string, limits: GeminiLimits, now: Date, timeZone?: string): void {
    const refusal = this.check(model, limits, now, timeZone);
    if (refusal) throw refusal;
    const s = this.state(model, now);
    s.requests.push(now.getTime());
    s.dayRequests += 1;
  }

  /** Jetons réels (entrée + sortie), connus seulement après la réponse. */
  addTokens(model: string, tokens: number, now: Date): void {
    if (tokens > 0) this.state(model, now).tokens.push([now.getTime(), Math.round(tokens)]);
  }

  /** 429 journalier de Google : modèle refusé jusqu'à minuit du Pacifique. */
  markExhausted(model: string, now: Date): void {
    this.state(model, now).exhaustedUntil = nextPacificMidnight(now).getTime();
  }

  /** Requêtes déjà envoyées (journal), pour ne pas repartir de zéro au redémarrage. */
  seed(model: string, sentAt: readonly Date[], now: Date): void {
    const s = this.state(model, now);
    const day = pacificDay(now);
    for (const d of sentAt) {
      if (pacificDay(d) === day) s.dayRequests += 1;
      if (d.getTime() > now.getTime() - WINDOW_MS) s.requests.push(d.getTime());
    }
    s.requests.sort((a, b) => a - b);
  }

  usage(model: string, now: Date): { minuteRequests: number; minuteTokens: number; dayRequests: number; exhaustedUntil: Date | null } {
    const s = this.state(model, now);
    return {
      minuteRequests: s.requests.length,
      minuteTokens: s.tokens.reduce((n, [, k]) => n + k, 0),
      dayRequests: s.dayRequests,
      exhaustedUntil: s.exhaustedUntil > now.getTime() ? new Date(s.exhaustedUntil) : null,
    };
  }

  /** État du modèle, fenêtre glissante purgée et compteur remis à zéro au changement de jour du Pacifique. */
  private state(model: string, now: Date): ModelState {
    const day = pacificDay(now);
    let s = this.states.get(model);
    if (!s) {
      s = { requests: [], tokens: [], day, dayRequests: 0, exhaustedUntil: 0 };
      this.states.set(model, s);
    }
    if (s.day !== day) Object.assign(s, { day, dayRequests: 0 });
    const from = now.getTime() - WINDOW_MS;
    s.requests = s.requests.filter((at) => at > from);
    s.tokens = s.tokens.filter(([at]) => at > from);
    return s;
  }
}

interface RpcDetail {
  retryDelay?: string;
  violations?: Array<{ quotaId?: string }>;
}

/**
 * Quota journalier d'après le corps d'un 429 (`QuotaFailure.violations[].quotaId`,
 * « …PerDay… ») : seul ce modèle est épuisé, sans pause commune — sinon tous
 * les modèles s'arrêteraient pour rien.
 */
export function isDailyQuota(body: unknown): boolean {
  const details = (body as { error?: { details?: RpcDetail[] } } | null)?.error?.details;
  if (!Array.isArray(details)) return false;
  const ids = details.flatMap((d) => (d.violations ?? []).map((v) => v.quotaId ?? ''));
  return ids.some((id) => /PerDay/i.test(id)) && !ids.some((id) => /PerMinute/i.test(id));
}

/** Fin de la pause commune après un 429 : `RetryInfo.retryDelay`, sinon une heure. Jamais raccourcie. */
export function pauseAfter429(body: unknown, now: Date): Date {
  const details = (body as { error?: { details?: RpcDetail[] } } | null)?.error?.details;
  const delay = Array.isArray(details) ? details.find((d) => typeof d.retryDelay === 'string')?.retryDelay : undefined;
  const seconds = delay === undefined ? NaN : Number.parseFloat(delay);
  if (Number.isNaN(seconds)) return new Date(now.getTime() + 60 * 60_000);
  return new Date(now.getTime() + Math.ceil(seconds) * 1000);
}

/** Après un 503 : Google est saturé, cinq minutes. */
export const pauseAfter503 = (now: Date): Date => new Date(now.getTime() + 5 * 60_000);
