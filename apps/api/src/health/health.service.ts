import { access, constants, readdir } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type CheckState = 'ok' | 'error';
export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  checks: {
    database: CheckState;
    media: CheckState;
    migrations: 'ok' | 'pending' | 'error';
  };
  degraded?: string[];
}

/**
 * Section 21 : trois contrôles rendus séparément. Seule une base injoignable
 * justifie un 503 ; le reste dégrade sans interrompre le service.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async report(): Promise<HealthReport> {
    const [database, media, migrations] = await Promise.all([this.checkDatabase(), this.checkMedia(), this.checkMigrations()]);
    const degraded: string[] = [];
    if (media === 'error') degraded.push('media');
    if (migrations !== 'ok') degraded.push('migrations');
    if (this.config.VISION_PROVIDER === 'none') degraded.push('vision_disabled');

    const status: HealthReport['status'] = database === 'error' ? 'error' : degraded.length > 0 ? 'degraded' : 'ok';
    return {
      status,
      version: this.config.APP_VERSION,
      checks: { database, media, migrations },
      ...(degraded.length > 0 ? { degraded } : {}),
    };
  }

  private async checkDatabase(): Promise<CheckState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkMedia(): Promise<CheckState> {
    try {
      await access(this.config.mediaDir, constants.W_OK);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkMigrations(): Promise<HealthReport['checks']['migrations']> {
    try {
      const entries = await readdir(this.config.migrationsDir, { withFileTypes: true });
      const expected = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      const applied = await this.prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at FROM _prisma_migrations`;
      const done = new Set(applied.filter((m) => m.finished_at !== null).map((m) => m.migration_name));
      return expected.every((name) => done.has(name)) ? 'ok' : 'pending';
    } catch {
      return 'error';
    }
  }
}
