import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser, GoogleLoginInput } from '@kitchen/shared';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../common/api-error.js';
import { createDefaultLocations } from '../locations/default-locations.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GOOGLE_TOKEN_VERIFIER, type GoogleIdentity, type GoogleTokenVerifier } from './google-token.verifier.js';
import type { RequestUser } from './request-user.js';
import { SessionService } from './session.service.js';

const PENDING_MESSAGE = 'Votre demande attend la validation d’un administrateur.';
const REVOKED_MESSAGE = 'Cet accès a été refusé.';

interface Account {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
    @Inject(GOOGLE_TOKEN_VERIFIER) private readonly google: GoogleTokenVerifier,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /**
   * Section 10 (D1, D3, D7) : le jeton Google est vérifié côté serveur, le
   * compte est retrouvé **par adresse e-mail**, et aucune session n'est ouverte
   * tant que le compte n'est pas `ACTIVE`. Sur une base vide, la première
   * connexion crée l'administrateur.
   */
  async loginWithGoogle(input: GoogleLoginInput, res: Response): Promise<CurrentUser> {
    const identity = await this.google.verify(input.credential);
    // On n'authentifie personne sur une adresse qu'il ne contrôle pas.
    if (!identity.emailVerified) throw ApiError.unauthenticated('Adresse Google non vérifiée');

    const { account, created, first } = await this.resolveAccount(identity);
    if (first) this.logger.log({ userId: account.id }, 'Premier administrateur créé par connexion Google');
    else if (created) this.logger.log({ userId: account.id }, 'Demande d’accès créée, en attente de validation');

    // Un compte neuf répond exactement comme un compte déjà en attente : la page
    // de connexion ne doit pas servir à énumérer les adresses connues du foyer.
    if (account.status === 'REVOKED') throw ApiError.forbidden(REVOKED_MESSAGE);
    if (account.status !== 'ACTIVE') throw ApiError.forbidden(PENDING_MESSAGE);

    await this.sessions.open(account.id, res);
    return toCurrentUser(account);
  }

  /** Retrouve le compte par adresse, ou le crée — sous le verrou d'exclusion pour une création. */
  private async resolveAccount(identity: GoogleIdentity): Promise<{ account: Account; created: boolean; first: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { email: identity.email } });
    if (existing) return { account: await this.attachGoogleSub(existing, identity), created: false, first: false };

    return this.prisma.$transaction(async (tx) => {
      // Verrou d'exclusion : deux connexions simultanées sur une base vide ne
      // créent qu'un seul administrateur (D7).
      await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
      const raced = await tx.user.findUnique({ where: { email: identity.email } });
      if (raced) return { account: raced, created: false, first: false };

      const first = (await tx.user.count()) === 0;
      const account = await tx.user.create({
        data: {
          email: identity.email,
          name: identity.name ?? identity.email,
          // `sub` n'est stocké que pour mémoire : jamais deux comptes dessus,
          // sinon une adresse Google changée ne pourrait plus faire de demande.
          googleSub: (await tx.user.findUnique({ where: { googleSub: identity.sub } })) ? null : identity.sub,
          passwordHash: null,
          role: first ? 'ADMIN' : 'MEMBER',
          status: first ? 'ACTIVE' : 'PENDING',
        },
      });
      if (first) await createDefaultLocations(tx);
      return { account, created: true, first };
    });
  }

  /** Mémorise le `sub` sur un compte retrouvé par son adresse, s'il est libre. */
  private async attachGoogleSub(user: Account & { googleSub: string | null }, identity: GoogleIdentity): Promise<Account> {
    if (user.googleSub) return user;
    const taken = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });
    if (taken) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { googleSub: identity.sub } });
  }

  async logout(user: RequestUser, res: Response): Promise<void> {
    if (user.sessionId) await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookie(res);
  }
}

export function toCurrentUser(user: { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER' }): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
