import { Injectable } from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async revokeSessions(userId: string): Promise<void> {
    await this.sessions.revokeAll(userId);
  }
}

