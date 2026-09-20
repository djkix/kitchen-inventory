import { Injectable } from '@nestjs/common';
import type { CreateUserInput } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { hashPassword } from '../auth/password.js';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toDto);
  }

  async create(input: CreateUserInput): Promise<UserDto> {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw ApiError.conflict('Un compte existe déjà avec cette adresse');
    }
    const user = await this.prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password) },
    });
    return toDto(user);
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.sessions.revokeAll(userId);
  }
}

function toDto(user: { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; createdAt: Date }): UserDto {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() };
}
