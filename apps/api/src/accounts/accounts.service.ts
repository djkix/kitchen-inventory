import { Injectable } from '@nestjs/common';
import type { AccountDto } from '@kitchen/shared';
import { SessionService } from '../auth/session.service.js';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

type AccountRow = { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; status: AccountDto['status']; createdAt: Date };

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /** En attente d'abord, puis du plus récent au plus ancien. */
  async list(): Promise<AccountDto[]> {
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    const rank = (a: AccountRow): number => (a.status === 'PENDING' ? 0 : 1);
    return rows.sort((a, b) => rank(a) - rank(b)).map(toDto);
  }

  async approve(id: string): Promise<AccountDto> {
    const found = await this.prisma.user.findUnique({ where: { id } });
    if (!found) throw ApiError.notFound('Compte introuvable');
    return toDto(await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } }));
  }

  async revoke(id: string, actorId: string): Promise<AccountDto> {
    if (id === actorId) throw ApiError.forbidden('Vous ne pouvez pas révoquer votre propre compte');

    const user = await this.prisma.$transaction(async (tx) => {
      // Verrou : deux révocations simultanées ne doivent pas chacune voir « un autre
      // administrateur reste actif » et en laisser zéro.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounts-admin-guard'))`;
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw ApiError.notFound('Compte introuvable');
      if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
        const others = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } } });
        if (others === 0) throw ApiError.forbidden('Impossible de révoquer le dernier administrateur actif');
      }
      return tx.user.update({ where: { id }, data: { status: 'REVOKED' } });
    });

    // Une révocation qui attendrait la prochaine connexion ne servirait à rien :
    // la session en cours est précisément ce qu'on veut couper.
    await this.sessions.revokeAll(id);
    return toDto(user);
  }
}

function toDto(u: AccountRow): AccountDto {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt.toISOString() };
}
