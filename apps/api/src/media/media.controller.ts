import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { MediaService, MIME_BY_EXTENSION } from './media.service.js';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** `GET /api/v1/media/<chemin relatif>`, derrière la garde de session comme toute route. */
  @Get('{*path}')
  async serve(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rel = decodeURIComponent(req.path.replace(/^\/api\/v1\/media\//, ''));
    const abs = this.media.resolve(rel);
    if (!abs) throw ApiError.notFound('Média introuvable');
    try {
      const info = await stat(abs);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw ApiError.notFound('Média introuvable');
    }
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Type', MIME_BY_EXTENSION[extname(abs).slice(1)] ?? 'application/octet-stream');
    res.sendFile(abs);
  }
}
