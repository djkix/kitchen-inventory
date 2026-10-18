import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from './request-user.js';
import { hashToken, newSessionToken } from './tokens.js';

export const SESSION_COOKIE = 'sid';
const DAY_MS = 86_400_000;

/** Ce qu'`open` utilise du client Prisma : le service, ou un client de transaction. */
type SessionWriter = Pick<PrismaService, 'session'>;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Ouvre une session et pose le cookie. `tx` permet d'inscrire la session
   * dans une transaction en cours : la porte de secours (D6) efface le mot de
   * passe à usage unique et ouvre la session d'un seul tenant.
   */
  async open(userId: string, res: Response, tx: SessionWriter = this.prisma): Promise<void> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * DAY_MS);
    await tx.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.NODE_ENV === 'production',
      path: '/',
      maxAge: this.config.SESSION_TTL_DAYS * DAY_MS,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Révoque toutes les sessions d'un utilisateur, sauf éventuellement la courante. */
  async revokeAll(userId: string, exceptSessionId?: string | null): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Identifie l'appelant par cookie de session ou jeton de service. */
  async authenticate(request: Request): Promise<RequestUser | null> {
    const bearer = request.headers.authorization;
    if (bearer?.startsWith('Bearer kit_')) return this.authenticateServiceToken(bearer.slice('Bearer '.length));

    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (!token) return null;

    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;

    // Expiration glissante, rafraîchie au plus une fois par jour pour limiter les écritures.
    if (Date.now() - session.lastSeenAt.getTime() > DAY_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + this.config.SESSION_TTL_DAYS * DAY_MS) },
      });
    }
    const { user } = session;
    // La validation du compte se vérifie à chaque requête, pas seulement à la
    // connexion : une révocation coupe l'accès même si le chemin qui l'a posée
    // a oublié d'appeler `revokeAll` (revue de la tâche 3, D3).
    if (user.status !== 'ACTIVE') return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role, via: 'session', sessionId: session.id };
  }

  private async authenticateServiceToken(token: string): Promise<RequestUser | null> {
    const found = await this.prisma.serviceToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!found) return null;
    await this.prisma.serviceToken.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
    return { id: `service:${found.id}`, email: '', name: found.name, role: 'MEMBER', via: 'service-token', sessionId: null };
  }
}
