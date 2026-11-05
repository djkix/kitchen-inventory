import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { BackupStatus } from '@kitchen/shared';
import { AdminOnly } from '../auth/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { backupWarnings } from './backup.js';

/**
 * Sauvegarde vers le NAS, côté Réglages (administrateurs). L'API ne fait que
 * lire les tentatives et poser une demande : le service `backup` la prend
 * dans les 5 minutes (docker/backup/schedule.sh).
 */
@AdminOnly()
@Controller('backup')
export class BackupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async status(): Promise<BackupStatus> {
    const [last, success, requests] = await Promise.all([
      this.prisma.backupAttempt.findFirst({ orderBy: { finishedAt: 'desc' } }),
      this.prisma.backupAttempt.findFirst({ where: { succeeded: true }, orderBy: { finishedAt: 'desc' } }),
      this.prisma.backupRequest.count(),
    ]);
    return {
      lastSuccess: success ? { finishedAt: success.finishedAt.toISOString(), dumpBytes: success.dumpBytes } : null,
      requested: requests > 0,
      warnings: backupWarnings(last, success?.finishedAt ?? null, new Date()),
    };
  }

  @Post('request')
  @HttpCode(202)
  async request(): Promise<BackupStatus> {
    // Deux appuis ne font qu’une sauvegarde : schedule.sh efface toutes les demandes d’un coup.
    if ((await this.prisma.backupRequest.count()) === 0) await this.prisma.backupRequest.create({ data: {} });
    return this.status();
  }
}
