import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateRequestDetails } from 'web-push';
import type { PushSubscriptionInput } from '@kitchen/shared';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Codes par lesquels un service de push dit que l'abonnement est mort. */
const GONE = [404, 410];

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Envoi Web Push (conception du 2026-11-02).
 *
 * `web-push` ne sert qu'à chiffrer et à signer : `generateRequestDetails` rend
 * la requête toute prête, qui part ensuite par le client HTTP injecté — le
 * même que Gemini et Open Food Facts. Les tests la doublent donc comme les
 * leurs, sans ouvrir de socket (section 19).
 *
 * Sans clés VAPID, tout est inerte et rien ne lève : l'application marche
 * sans notification (D11).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_CLIENT) private readonly http: HttpClient,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY);
  }

  get publicKey(): string | null {
    return this.enabled ? (this.config.VAPID_PUBLIC_KEY ?? null) : null;
  }

  async subscribe(userId: string, input: PushSubscriptionInput, userAgent?: string): Promise<void> {
    const data = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent ?? null, lastUsedAt: new Date() };
    // Le navigateur rend le même abonnement à chaque ouverture : l'adresse
    // fait l'identité, et un réabonnement se contente de la rafraîchir.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /**
   * Annonce à tous les appareils abonnés de cet utilisateur, et à eux seuls
   * (D14). Un abonnement périmé est supprimé sans empêcher les autres d'être
   * prévenus, et aucune panne du service de push ne remonte à l'appelant :
   * une notification manquée ne doit jamais faire échouer la demande qu'elle
   * annonce.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const devices = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(devices.map((device) => this.sendTo(device, payload)));
  }

  private async sendTo(device: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<void> {
    try {
      const details = generateRequestDetails(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: this.config.VAPID_SUBJECT,
            publicKey: this.config.VAPID_PUBLIC_KEY!,
            privateKey: this.config.VAPID_PRIVATE_KEY!,
          },
        },
      );
      const response = await this.http(details.endpoint, {
        method: details.method,
        headers: details.headers as Record<string, string>,
        body: details.body ?? undefined,
      });
      if (GONE.includes(response.status)) {
        await this.prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => undefined);
        return;
      }
      if (!response.ok) this.logger.warn(`Notification refusée (${response.status}) par ${new URL(device.endpoint).host}`);
      else await this.prisma.pushSubscription.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    } catch (error) {
      this.logger.warn({ err: error }, 'Notification non envoyée');
    }
  }
}
