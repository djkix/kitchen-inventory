import { randomUUID } from 'node:crypto';
import { access, constants, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
};

export const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

/**
 * Les images vivent sur le disque (volume `media`), la base ne garde que le
 * chemin relatif (section 6). Servies uniquement derrière la session.
 */
@Injectable()
export class MediaService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isSupportedMime(mimeType: string): boolean {
    return mimeType in EXTENSIONS;
  }

  /**
   * Enregistre un fichier et renvoie son chemin relatif, ex.
   * `scans/2026/09/<uuid>.jpg`. Le préfixe `differe` ne garde une entrée que
   * le temps d'un rejeu (conception du 2026-11-02) : `remove` l'efface dès que
   * la demande aboutit ou est abandonnée.
   */
  async save(buffer: Buffer, mimeType: string, prefix: 'products' | 'scans' | 'differe'): Promise<string> {
    const ext = EXTENSIONS[mimeType] ?? 'bin';
    const now = new Date();
    const dir = join(prefix, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
    await mkdir(join(this.config.mediaDir, dir), { recursive: true });
    const rel = join(dir, `${randomUUID()}.${ext}`).split(sep).join('/');
    await writeFile(join(this.config.mediaDir, rel), buffer);
    return rel;
  }

  /** Efface un média ; l'absence n'est pas une erreur. */
  async remove(rel: string): Promise<void> {
    const abs = this.resolve(rel);
    if (abs) await rm(abs, { force: true });
  }

  /** Chemin absolu d'un média, en refusant toute sortie du dossier (`..`). */
  resolve(rel: string): string | null {
    const abs = resolve(this.config.mediaDir, normalize(rel));
    return abs.startsWith(`${this.config.mediaDir}${sep}`) ? abs : null;
  }

  /**
   * Comme `resolve`, mais pour ce qui est servi par HTTP : `differe` est
   * refusé. Ce dossier ne garde pas une galerie, mais l'entrée d'une demande
   * en attente de rejeu — une photo de ticket, un enregistrement vocal. Elle
   * vit sous `mediaDir` pour être effacée avec le reste, pas pour être lue
   * (audit du 2026-11-11). Le refus est jugé après normalisation : `a/../differe`
   * est bien `differe`.
   */
  resolvePublic(rel: string): string | null {
    const abs = this.resolve(rel);
    return abs !== null && abs.startsWith(join(this.config.mediaDir, 'differe') + sep) ? null : abs;
  }

  async checkWritable(): Promise<boolean> {
    try {
      await access(this.config.mediaDir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
