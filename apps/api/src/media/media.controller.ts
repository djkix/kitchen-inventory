import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { MediaService, MIME_BY_EXTENSION } from './media.service.js';

/** Chemin décodé, ou `null` si l'URL est mal encodée — un 404, pas un 500. */
function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** `GET /api/v1/media/<chemin relatif>`, derrière la garde de session comme toute route. */
  @Get('{*path}')
  async serve(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rel = decodePath(req.path.replace(/^\/api\/v1\/media\//, ''));
    const abs = rel === null ? null : this.media.resolvePublic(rel);
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
