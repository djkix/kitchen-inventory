import { Injectable } from '@nestjs/common';
import type { ChangePasswordInput, CurrentUser, LoginInput, SetupInput } from '@kitchen/shared';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../common/api-error.js';
import { createDefaultLocations } from '../locations/default-locations.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
import type { RequestUser } from './request-user.js';
import { SessionService } from './session.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const INVALID_CREDENTIALS = 'Identifiants incorrects';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /** Section 10 : pas de compte par défaut, création du premier administrateur à l'installation. */
  async setup(input: SetupInput, res: Response): Promise<CurrentUser> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      // Verrou d'exclusion : deux installations simultanées ne créent qu'un admin.
      await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
      if ((await tx.user.count()) > 0) throw ApiError.conflict('L’installation a déjà été effectuée');
      const created = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, role: 'ADMIN' } });
      await createDefaultLocations(tx);
      return created;
    });
    await this.sessions.open(user.id, res);
    this.logger.log({ userId: user.id }, 'Premier administrateur créé');
    return toCurrentUser(user);
  }

  async login(input: LoginInput, res: Response): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Coût constant : on vérifie quand même un hachage pour ne pas révéler l'existence du compte.
      await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', input.password);
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw ApiError.rateLimited('Compte temporairement verrouillé après plusieurs échecs', { lockedUntil: user.lockedUntil.toISOString() });
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failedLogins = user.failedLogins + 1;
      const lock = failedLogins >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failedLogins, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      if (lock) this.logger.warn({ userId: user.id }, 'Compte verrouillé après échecs répétés');
      throw ApiError.unauthenticated(INVALID_CREDENTIALS);
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    await this.sessions.open(user.id, res);
  }

  async logout(user: RequestUser, res: Response): Promise<void> {
    if (user.sessionId) await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookie(res);
  }

  async changePassword(user: RequestUser, input: ChangePasswordInput): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(record.passwordHash, input.currentPassword))) {
      throw ApiError.businessRule('Mot de passe actuel incorrect');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
    await this.sessions.revokeAll(user.id, user.sessionId);
  }
}

export function toCurrentUser(user: { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER' }): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
