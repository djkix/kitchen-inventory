import { existsSync } from 'node:fs';
import { Controller, Get, Header, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { Public } from '../auth/public.decorator.js';
import type { AppConfig } from '../common/config.js';

/** Section 10 : aucun robot, l'application est publiée sur Internet mais privée. */
@Controller()
class RobotsController {
  @Public()
  @Get('/robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots(): string {
    return 'User-agent: *\nDisallow: /\n';
  }
}

/**
 * Sert le front compilé (`apps/web/dist`) sur toutes les routes hors `/api`,
 * avec repli sur `index.html` pour l'application monopage. Sans dossier
 * compilé (développement avec Vite), seul `/api` répond.
 */
@Module({ controllers: [RobotsController] })
export class SpaModule {
  static forRoot(config: AppConfig) {
    const dist = config.webDistDir;
    const imports = dist && existsSync(dist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: dist,
            exclude: ['/api/{*path}'],
            serveStaticOptions: {
              // index.html et le manifeste ne doivent jamais être mis en cache longtemps ; les assets hachés, oui.
              setHeaders: (res, path) => {
                if (/\.(js|css|woff2?|png|svg|webp)$/.test(path) && /assets\//.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                else res.setHeader('Cache-Control', 'no-cache');
              },
            },
          }),
        ]
      : [];
    return { module: SpaModule, imports, controllers: [RobotsController] };
  }
}
