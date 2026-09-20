import { Injectable } from '@nestjs/common';
import { hashToken, newServiceToken } from '../auth/tokens.js';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ServiceTokenDto {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

@Injectable()
export class ServiceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ServiceTokenDto[]> {
    const rows = await this.prisma.serviceToken.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  /** Le jeton en clair n'est renvoyé qu'à la création. */
  async create(name: string): Promise<ServiceTokenDto & { token: string }> {
    const token = newServiceToken();
    const row = await this.prisma.serviceToken.create({ data: { name, tokenHash: hashToken(token) } });
    return { ...toDto(row), token };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.serviceToken.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Jeton introuvable');
    await this.prisma.serviceToken.delete({ where: { id } });
  }
}

function toDto(row: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }): ServiceTokenDto {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null };
}
