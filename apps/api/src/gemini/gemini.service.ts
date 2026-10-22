import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { GeminiLimitsInput, GeminiStatus } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { GeminiPausedError, GeminiQuotaError } from './gemini-errors.js';
import { isStableModel, orderModels } from './gemini-models.js';
import { GeminiLimiter, isDailyQuota, pauseAfter429, pauseAfter503, type GeminiLimits } from './gemini-quota.js';
import { nextPacificMidnight, resumeAt } from './gemini-time.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
/** Repli quand la liste de Google est indisponible et que `VISION_MODEL` est vide. */
const FALLBACK_MODEL = 'gemini-3.8-flash';
const LIST_TTL_MS = 60 * 60_000;
/** Un échec de liste n'est retenu qu'une minute : l'écran ne subit pas le délai de Google à chaque ouverture. */
const LIST_ERROR_TTL_MS = 60_000;
const GENERATE = /\/models\/([^/:?]+):generateContent/;

/** Clés de `Setting` : limites réglées par modèle, pause commune. */
const LIMITS_KEY = 'geminiLimits';
const PAUSE_KEY = 'geminiPause';

type Pause = { until: Date; reason: string };

/**
 * Point de passage unique des appels à Gemini (approche de Ma Cave, guide
 * `approche-ia-gemini.md`) :
 *
 * - `call(run)` choisit le modèle dans la liste en direct de Google et bascule
 *   sur le suivant quand un quota l'arrête ;
 * - `http` est le client que reçoivent les fournisseurs : avant chaque
 *   `generateContent`, pause commune et quota du modèle sont vérifiés ; après,
 *   les jetons sont comptés, la requête journalisée, et un 429 ou un 503 pose
 *   la pause commune (ou épuise le modèle pour la journée).
 *
 * Tout refus lève `GeminiPausedError`, dont le message porte l'heure de
 * reprise : l'utilisateur n'attend jamais un appel voué à l'échec.
 */
@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private readonly limiter = new GeminiLimiter();
  private list: { at: number; models: string[]; error?: string } | null = null;
  private pause: Pause | null = null;
  /** Horloge remplaçable par les tests. */
  now = (): Date => new Date();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_CLIENT) private readonly httpClient: HttpClient,
  ) {}

  /** Recharge pause et compteurs du jour depuis la base : un redémarrage ne remet pas les quotas à zéro. */
  async onModuleInit(): Promise<void> {
    try {
      const now = this.now();
      const stored = await this.prisma.setting.findUnique({ where: { key: PAUSE_KEY } });
      const value = stored?.value as { until?: string; reason?: string } | undefined;
      const until = new Date(value?.until ?? '');
      if (!Number.isNaN(until.getTime()) && until > now) this.pause = { until, reason: value?.reason ?? '' };
      // Un jour du Pacifique dure au plus 25 h.
      const calls = await this.prisma.geminiCall.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 25 * 3_600_000) } }, select: { model: true, createdAt: true } });
      const byModel = new Map<string, Date[]>();
      for (const c of calls) byModel.set(c.model, [...(byModel.get(c.model) ?? []), c.createdAt]);
      for (const [model, sentAt] of byModel) this.limiter.seed(model, sentAt, now);
    } catch (error) {
      // Rien d'annexe ne casse un appel : sans journal, le limiteur part de zéro.
      this.logger.error({ err: error }, 'Journal Gemini illisible au démarrage');
    }
  }

  /** Oublie compteurs, pause et liste en mémoire : remise à zéro entre deux tests. */
  forget(): void {
    Object.assign(this, { limiter: new GeminiLimiter(), list: null, pause: null });
  }

  /**
   * Essaie les modèles dans l'ordre d'emploi : un quota atteint (local ou 429
   * journalier de Google) passe au suivant, puisque Google compte par modèle.
   * Rien n'est envoyé pour un modèle refusé par le limiteur. Tous refusés :
   * le refus qui se lève le plus tôt remonte, avec son heure de reprise.
   */
  async call<T>(run: (model: string) => Promise<T>): Promise<{ result: T; model: string; fellBack: boolean }> {
    this.assertNotPaused();
    const models = await this.candidates();
    let refusal: GeminiQuotaError | null = null;
    for (const model of models) {
      try {
        return { result: await run(model), model, fellBack: model !== models[0] };
      } catch (error) {
        if (!(error instanceof GeminiQuotaError)) throw error;
        if (!refusal || error.until < refusal.until) refusal = error;
      }
    }
    throw refusal ?? new ProviderError('Aucun modèle Gemini Flash ou Flash-Lite disponible');
  }

  /** Client HTTP des fournisseurs Gemini : laisse passer tout ce qui n'est pas `generateContent`. */
  readonly http: HttpClient = async (url, init) => {
    const match = GENERATE.exec(url);
    if (!match) return this.httpClient(url, init);
    const model = decodeURIComponent(match[1]!);
    this.assertNotPaused();
    const limits = await this.limits(model);
    // Vérifier puis réserver sans `await` entre les deux : atomique en mono-processus.
    this.limiter.reserve(model, limits, this.now());
    const started = Date.now();
    let response: Response;
    try {
      response = await this.httpClient(url, init);
    } catch (error) {
      await this.record(model, null, null, started);
      throw error;
    }
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const usage = (body as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } } | null)?.usageMetadata;
    const tokens = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);
    this.limiter.addTokens(model, tokens, this.now());
    await this.record(model, response.status, tokens || null, started);

    if (response.status === 429) {
      const now = this.now();
      if (isDailyQuota(body)) {
        // Quota du jour de CE modèle : il est épuisé, les autres restent ouverts.
        this.limiter.markExhausted(model, now);
        const until = nextPacificMidnight(now);
        throw new GeminiQuotaError(until, 'day', `Quota Gemini du jour atteint chez Google : reprise ${resumeAt(until, now)}.`);
      }
      throw await this.extendPause(pauseAfter429(body, now), 'quota dépassé chez Google');
    }
    if (response.status === 503) throw await this.extendPause(pauseAfter503(this.now()), 'service saturé');
    return response;
  };

  /** Ordre d'emploi, relu à chaque appel. */
  async candidates(): Promise<string[]> {
    return orderModels((await this.available()).models);
  }

  /** Limites d'un modèle : réglage du modèle, sinon `GEMINI_RPM/TPM/RPD`, sinon niveau gratuit. */
  async limits(model: string): Promise<GeminiLimits> {
    const fallback = { rpm: this.config.GEMINI_RPM, tpm: this.config.GEMINI_TPM, rpd: this.config.GEMINI_RPD };
    try {
      const all = await this.storedLimits();
      return { ...fallback, ...all[model] };
    } catch (error) {
      this.logger.error({ err: error }, 'Limites Gemini illisibles, défauts appliqués');
      return fallback;
    }
  }

  async setLimits({ model, ...limits }: GeminiLimitsInput): Promise<GeminiStatus> {
    if (!(await this.available()).models.includes(model)) throw ApiError.businessRule(`Modèle inconnu ou non léger : ${model}`);
    const all = { ...(await this.storedLimits()), [model]: limits };
    await this.prisma.setting.upsert({ where: { key: LIMITS_KEY }, create: { key: LIMITS_KEY, value: all }, update: { value: all } });
    return this.status();
  }

  /** État pour l'écran des modèles : ordre d'emploi, consommation, limites, épuisement, pause. */
  async status(): Promise<GeminiStatus> {
    const now = this.now();
    const list = await this.available();
    const models = await Promise.all(
      orderModels(list.models).map(async (model) => {
        const limits = await this.limits(model);
        const usage = this.limiter.usage(model, now);
        const refusal = this.limiter.check(model, limits, now);
        return {
          model,
          limits,
          minuteRequests: usage.minuteRequests,
          minuteTokens: usage.minuteTokens,
          dayRequests: usage.dayRequests,
          blockedUntil: refusal?.until.toISOString() ?? null,
          blockedMessage: refusal?.message ?? null,
        };
      }),
    );
    const pause = this.pause && this.pause.until > now ? this.pause : null;
    return {
      current: pause ? null : (models.find((m) => m.blockedUntil === null)?.model ?? null),
      models,
      pause: pause ? { until: pause.until.toISOString(), message: this.pauseMessage(pause, now) } : null,
      dayResetsAt: nextPacificMidnight(now).toISOString(),
      ...(list.error ? { error: list.error } : {}),
    };
  }

  private assertNotPaused(): void {
    const now = this.now();
    if (this.pause && this.pause.until > now) throw new GeminiPausedError(this.pause.until, this.pauseMessage(this.pause, now));
  }

  private pauseMessage(pause: Pause, now: Date): string {
    return `Gemini est en pause (${pause.reason}) : reprise ${resumeAt(pause.until, now)}.`;
  }

  /** Pose ou prolonge la pause commune, jamais ne la raccourcit ; rend l'erreur à lever. */
  private async extendPause(until: Date, reason: string): Promise<GeminiPausedError> {
    if (!this.pause || this.pause.until < until) this.pause = { until, reason };
    const value = { until: this.pause.until.toISOString(), reason: this.pause.reason };
    try {
      await this.prisma.setting.upsert({ where: { key: PAUSE_KEY }, create: { key: PAUSE_KEY, value }, update: { value } });
    } catch (error) {
      this.logger.error({ err: error }, 'Pause Gemini non enregistrée');
    }
    return new GeminiPausedError(this.pause.until, this.pauseMessage(this.pause, this.now()));
  }

  private async record(model: string, httpStatus: number | null, tokens: number | null, started: number): Promise<void> {
    try {
      await this.prisma.geminiCall.create({ data: { model, httpStatus, tokens, durationMs: Date.now() - started } });
    } catch (error) {
      this.logger.error({ err: error }, 'Appel Gemini non journalisé');
    }
  }

  private async storedLimits(): Promise<Record<string, Partial<GeminiLimits>>> {
    const row = await this.prisma.setting.findUnique({ where: { key: LIMITS_KEY } });
    return (row?.value ?? {}) as Record<string, Partial<GeminiLimits>>;
  }

  /** Liste en direct de Google (Flash et Flash-Lite stables), cache 1 h ; échec : `VISION_MODEL` et l'erreur. */
  private async available(): Promise<{ models: string[]; error?: string }> {
    const ttl = this.list?.error ? LIST_ERROR_TTL_MS : LIST_TTL_MS;
    if (this.list && Date.now() - this.list.at < ttl) return this.list;
    let value: { models: string[]; error?: string };
    try {
      const models = await this.fetchModels();
      value = models.length > 0 ? { models } : { models: this.fallbackModels(), error: 'Google ne déclare aucun modèle Flash ou Flash-Lite stable pour cette clé.' };
    } catch (error) {
      value = { models: this.fallbackModels(), error: `Liste des modèles indisponible (${error instanceof Error ? error.message : String(error)}) ; repli sur ${this.fallbackModels().join(', ')}.` };
    }
    this.list = { at: Date.now(), ...value };
    return value;
  }

  private fallbackModels(): string[] {
    const model = this.config.VISION_MODEL ?? FALLBACK_MODEL;
    return isStableModel(model) ? [model] : [FALLBACK_MODEL];
  }

  private async fetchModels(): Promise<string[]> {
    if (this.config.VISION_PROVIDER !== 'gemini' || !this.config.VISION_API_KEY) throw new Error('aucune clé Gemini configurée');
    const base = (this.config.VISION_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const names = new Set<string>();
    let pageToken = '';
    do {
      const url = `${base}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
      const response = await this.httpClient(url, { headers: { 'x-goog-api-key': this.config.VISION_API_KEY }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Google a répondu ${response.status}`);
      const page = (await response.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string };
      for (const m of page.models ?? []) {
        const name = (m.name ?? '').replace(/^models\//, '');
        if (isStableModel(name) && m.supportedGenerationMethods?.includes('generateContent')) names.add(name);
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return [...names];
  }
}
