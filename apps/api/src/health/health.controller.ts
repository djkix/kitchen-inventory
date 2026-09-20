import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  async get(@Res() res: Response): Promise<void> {
    const report = await this.health.report();
    res.status(report.status === 'error' ? 503 : 200).json(report);
  }
}
