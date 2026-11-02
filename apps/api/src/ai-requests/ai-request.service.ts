import { Injectable, Logger } from '@nestjs/common';
import { notificationPayload, shouldNotify, type AiRequestKind, type AiRequestState, type AiRequestStatusDto } from '@kitchen/shared';
import { Prisma, type AiRequest } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { PushService } from '../notifications/push.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Une ligne par appel au modèle (conception du 2026-11-02).
 *
 * Ouverte avant de partir chez Google, close à l'arrivée du résultat. Dans le
 * cas courant — réponse en huit secondes, écran allumé — elle n'aura servi à
 * rien : la réponse HTTP a déjà porté le résultat (D2). Elle devient le seul
 * chemin vers lui dès que le téléphone a été posé.
 */
@Injectable()
export class AiRequestService {
  private readonly logger = new Logger(AiRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /**
   * Ouvre la ligne, ou laisse en place celle qui existe : le client rejoue le
   * même identifiant après une coupure, et un départ de page déjà signalé ne
   * doit pas être effacé par ce rejeu.
   */
  async open(input: { id: string; userId: string; kind: AiRequestKind }): Promise<void> {
    await this.prisma.aiRequest.upsert({
      where: { id: input.id },
      create: { id: input.id, userId: input.userId, kind: input.kind },
      update: {},
    });
  }

  /**
   * Encadre un appel au modèle : ouvre la ligne, la clôt avec son résultat,
   * et laisse remonter l'erreur telle quelle après l'avoir inscrite.
   *
   * Sans identifiant — une interface plus ancienne, ou une requête que
   * l'utilisateur n'a pas déclenchée lui-même — rien n'est ouvert et rien
   * n'est annoncé : le comportement d'avant, à l'octet près.
   */
  async track<T>(input: { id?: string; userId: string; kind: AiRequestKind }, run: () => Promise<T>, count?: (result: T) => number): Promise<T> {
    const { id } = input;
    if (!id) return run();
    await this.open({ id, userId: input.userId, kind: input.kind });
    try {
      const result = await run();
      await this.succeed(id, result, count?.(result));
      return result;
    } catch (error) {
      await this.fail(id, error instanceof Error ? error.message : 'La demande a échoué.');
      throw error;
    }
  }

  async succeed(id: string, result: unknown, count?: number): Promise<void> {
    await this.close(id, { state: 'DONE', result: result as never }, count);
  }

  async fail(id: string, error: string): Promise<void> {
    await this.close(id, { state: 'FAILED', error });
  }

  /** Abandon d'une demande différée : annoncé avec sa raison (D6, D13). */
  async abandon(id: string, reason: string): Promise<void> {
    await this.close(id, { state: 'ABANDONED', error: reason });
  }

  /** Le téléphone a été posé : la réponse devra être annoncée (D1). */
  async markLeftScreen(id: string, userId: string): Promise<void> {
    const { count } = await this.prisma.aiRequest.updateMany({ where: { id, userId }, data: { leftScreen: true } });
    if (count === 0) throw ApiError.notFound('Demande introuvable');
  }

  async status(id: string, userId: string): Promise<AiRequestStatusDto> {
    const row = await this.prisma.aiRequest.findFirst({ where: { id, userId } });
    // 404 et non 403 sur la demande d'un autre : on ne révèle pas son existence.
    if (!row) throw ApiError.notFound('Demande introuvable');
    return toDto(row);
  }

  /**
   * Clôt la ligne et annonce si la règle le dit. Une notification manquée ne
   * fait jamais échouer la demande qu'elle annonce : `sendToUser` avale déjà
   * ses pannes, et `notifiedAt` garantit qu'on ne sonne pas deux fois pour la
   * même demande.
   */
  private async close(id: string, data: { state: AiRequestState; result?: never; error?: string }, count?: number): Promise<void> {
    const row = await this.prisma.aiRequest.findUnique({ where: { id } });
    if (!row) return;
    const updated = await this.prisma.aiRequest.update({
      where: { id },
      data: { ...data, retryAt: null, inputPath: null, inputMime: null, inputJson: Prisma.DbNull },
    });
    if (row.notifiedAt) return;
    if (!shouldNotify({ leftScreen: updated.leftScreen, wasDeferred: row.state === 'DEFERRED' })) return;
    await this.prisma.aiRequest.update({ where: { id }, data: { notifiedAt: new Date() } });
    await this.push.sendToUser(updated.userId, notificationPayload({
      id,
      kind: updated.kind,
      outcome: updated.state === 'ABANDONED' || updated.state === 'FAILED' ? 'ABANDONED' : 'DONE',
      count,
      reason: updated.error ?? undefined,
    }));
  }
}

function toDto(row: AiRequest): AiRequestStatusDto {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    result: row.result ?? null,
    error: row.error,
    retryAt: row.retryAt?.toISOString() ?? null,
  };
}
