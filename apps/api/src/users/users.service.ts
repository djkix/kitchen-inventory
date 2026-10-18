import { Injectable } from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly sessions: SessionService) {}

  async revokeSessions(userId: string): Promise<void> {
    await this.sessions.revokeAll(userId);
  }
}

