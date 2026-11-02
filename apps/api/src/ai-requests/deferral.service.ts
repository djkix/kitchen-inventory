import { readFile } from 'node:fs/promises';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { deferralRetryAt, type AiRequestKind } from '@kitchen/shared';
import type { AiRequest } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { Inject } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiRequestService } from './ai-request.service.js';

/** Intervalle de la minuterie de rejeu : plus fin que ce que Google annonce jamais. */
const TICK_MS = 30_000;

/** Ce qu'une demande garde d'elle-même pour pouvoir être rejouée. */
export interface DeferredInput {
  /** Audio ou image, écrit sur le volume `media` sous le préfixe `differe`. */
  file?: { buffer: Buffer; mimeType: string };
  /** Le reste : emplacement, orientation, indice de scan. */
  json?: unknown;
}

/** Rejoue une demande à partir de ce qu'elle a gardé. */
export type Replayer = (input: { file: Buffer | null; mimeType: string | null; json: unknown; userId: string }) => Promise<{ result: unknown; count?: number }>;

/**
 * Demandes refusées pour une pause chez Google, gardées et rejouées à la
 * reprise (conception du 2026-11-02, D5, D6, D13, D15).
 *
 * La chaîne complète tient en trois gestes : garder l'entrée, attendre
 * l'heure annoncée, rejouer. Tout le reste — l'annonce, l'effacement de
 * l'entrée — est déjà porté par `AiRequestService`.
 *
 * Chaque usage enregistre son rejoueur à l'initialisation de son module :
 * c'est ce qui évite que ce service connaisse les quatre services métier, et
 * donc le cycle d'imports qui irait avec.
 */
@Injectable()
export class DeferralService implements OnModuleInit {
  private readonly logger = new Logger(DeferralService.name);
  private readonly replayers = new Map<AiRequestKind, Replayer>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: AiRequestService,
    private readonly media: MediaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.closeOrphans().catch((error: unknown) => this.logger.error({ err: error }, 'Demandes orphelines non closes'));
    // En test, la minuterie n'a rien à faire : les cas appellent `replayDue`
    // avec l'heure qu'ils veulent, et un réveil parasite fausserait leurs comptes.
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.replayDue(new Date()).catch(() => undefined), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  register(kind: AiRequestKind, replayer: Replayer): void {
    this.replayers.set(kind, replayer);
  }

  /**
   * Encadre un appel au modèle : ouvre la ligne, la clôt avec son résultat,
   * et — si le refus est une pause annoncée — garde la demande pour la
   * rejouer au lieu de la perdre.
   *
   * Sans identifiant — une interface plus ancienne, ou une requête que
   * l'utilisateur n'a pas déclenchée lui-même — rien n'est ouvert, rien n'est
   * différé, rien n'est annoncé : le comportement d'avant, à l'octet près.
   */
  async track<T>(
    input: { id?: string; userId: string; kind: AiRequestKind; payload?: () => DeferredInput },
    run: () => Promise<T>,
    count?: (result: T) => number,
  ): Promise<T> {
    const { id } = input;
    if (!id) return run();
    await this.requests.open({ id, userId: input.userId, kind: input.kind });
    try {
      const result = await run();
      await this.requests.succeed(id, result, count?.(result));
      return result;
    } catch (error) {
      const resumeAt = pauseResumeAt(error);
      if (resumeAt && input.payload) {
        const retryAt = await this.defer({ id, userId: input.userId, kind: input.kind, resumeAt, payload: input.payload() });
        // Différée : l'écran n'affiche plus un refus sec mais une attente, et
        // le résultat sera annoncé quoi qu'il arrive (D1b).
        if (retryAt) {
          throw ApiError.rateLimited(messageDiffere(error, retryAt), {
            ...(asDetails(error) ?? {}),
            deferred: true,
            requestId: id,
            retryAt: retryAt.toISOString(),
          });
        }
      }
      await this.requests.fail(id, error instanceof Error ? error.message : 'La demande a échoué.');
      throw error;
    }
  }

  /**
   * Garde la demande et programme son rejeu, ou rend `null` quand la reprise
   * annoncée est au-delà du plafond — un quota du jour, typiquement : mieux
   * vaut un refus tout de suite qu'une notification neuf heures plus tard.
   */
  async defer(input: { id: string; userId: string; kind: AiRequestKind; resumeAt: Date; payload: DeferredInput }): Promise<Date | null> {
    const retryAt = deferralRetryAt({ now: new Date(), resumeAt: input.resumeAt });
    if (!retryAt) return null;

    // D15 : réappuyer ne doit pas faire deux appels payés ni deux
    // notifications pour une seule envie. La précédente s'efface en silence.
    await this.replacePending(input.userId, input.kind, input.id);

    const inputPath = input.payload.file ? await this.media.save(input.payload.file.buffer, input.payload.file.mimeType, 'differe') : null;
    await this.prisma.aiRequest.update({
      where: { id: input.id },
      data: {
        state: 'DEFERRED',
        retryAt,
        inputPath,
        inputMime: input.payload.file?.mimeType ?? null,
        inputJson: (input.payload.json ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
    return retryAt;
  }

  /** Rejoue les demandes dont l'heure est venue. */
  async replayDue(now: Date): Promise<void> {
    const due = await this.prisma.aiRequest.findMany({ where: { state: 'DEFERRED', retryAt: { lte: now } } });
    for (const row of due) await this.replay(row);
  }

  /**
   * Un redémarrage laisse des lignes « en cours » que plus personne ne mène à
   * bien (D12). Elles sont closes en échec ; seules celles qu'on attendait
   * sont annoncées, ce dont `AiRequestService` décide déjà.
   */
  async closeOrphans(): Promise<void> {
    const orphans = await this.prisma.aiRequest.findMany({ where: { state: 'RUNNING' }, select: { id: true } });
    for (const { id } of orphans) {
      await this.requests.fail(id, 'La demande a été interrompue par un redémarrage du serveur.');
    }
  }

  private async replay(row: AiRequest): Promise<void> {
    const replayer = this.replayers.get(row.kind);
    if (!replayer) {
      await this.abandon(row, 'Cette demande ne peut plus être rejouée.');
      return;
    }
    // Marquée « en cours » le temps du rejeu : deux tours de minuterie qui se
    // chevauchent ne doivent pas la jouer deux fois. L'état d'origine reste
    // connu de `succeed` par `notifiedAt`, qui n'a pas bougé.
    await this.prisma.aiRequest.update({ where: { id: row.id }, data: { state: 'RUNNING', retryAt: null } });
    try {
      const file = row.inputPath ? await this.readInput(row.inputPath) : null;
      const { result, count } = await replayer({ file, mimeType: row.inputMime, json: row.inputJson, userId: row.userId });
      await this.cleanInput(row);
      await this.requests.succeed(row.id, result, count, { wasDeferred: true });
    } catch (error) {
      // D13 : jamais un second différé. Le quota a pu être épuisé entre-temps
      // par l'autre membre du foyer, et la reprise suivante serait à minuit du
      // Pacifique — bien au-delà du plafond.
      await this.abandon(row, error instanceof Error ? error.message : 'La demande n’a pas pu être rejouée.');
    }
  }

  private async abandon(row: AiRequest, reason: string): Promise<void> {
    await this.cleanInput(row);
    await this.requests.abandon(row.id, reason, { wasDeferred: true });
  }

  private async readInput(path: string): Promise<Buffer | null> {
    const abs = this.media.resolve(path);
    if (!abs) return null;
    return readFile(abs).catch(() => null);
  }

  private async cleanInput(row: AiRequest): Promise<void> {
    if (row.inputPath) await this.media.remove(row.inputPath).catch(() => undefined);
  }

  /** La demande différée que celle-ci remplace : abandonnée sans un mot (D15). */
  private async replacePending(userId: string, kind: AiRequestKind, exceptId: string): Promise<void> {
    const pending = await this.prisma.aiRequest.findMany({ where: { userId, kind, state: 'DEFERRED', id: { not: exceptId } } });
    for (const row of pending) {
      await this.cleanInput(row);
      await this.prisma.aiRequest.update({
        where: { id: row.id },
        data: { state: 'ABANDONED', error: 'Remplacée par une demande plus récente.', retryAt: null, inputPath: null, inputMime: null, inputJson: Prisma.DbNull, notifiedAt: new Date() },
      });
    }
  }
}

/**
 * L'heure de reprise portée par un refus, ou `null` si ce n'en est pas un.
 * Les services convertissent `GeminiPausedError` en `ApiError` avant de la
 * laisser remonter : c'est donc `details.retryAt` qu'on lit, et lui seul — un
 * quota journalier d'usage n'en porte pas, et ne se diffère donc pas.
 */
function pauseResumeAt(error: unknown): Date | null {
  if (!(error instanceof ApiError) || error.code !== 'rate_limited') return null;
  const raw = (error.details as { retryAt?: unknown } | undefined)?.retryAt;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDetails(error: unknown): Record<string, unknown> | null {
  return error instanceof ApiError && error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : null;
}

function messageDiffere(error: unknown, retryAt: Date): string {
  const heure = retryAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const cause = error instanceof Error ? error.message : '';
  return `${cause} Votre demande est gardée : elle repartira vers ${heure} et vous serez prévenu du résultat.`.trim();
}
