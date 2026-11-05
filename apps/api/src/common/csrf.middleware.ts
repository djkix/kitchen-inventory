import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../auth/session.service.js';
import type { AppConfig } from './config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Message rendu à une écriture venue d'une autre origine. */
export const CSRF_MESSAGE = 'Requête refusée : elle ne vient pas de l’application';

function originOf(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const { protocol, hostname } = new URL(origin);
  return protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

/**
 * Décide si une requête qui modifie l'état peut passer (revue de sécurité du
 * 2026-10-22). Le cookie de session est `SameSite=Lax`, ce qui arrête déjà la
 * plupart des envois inter-sites ; cette vérification ferme le reste — un
 * sous-domaine voisin (même « site »), un navigateur ancien — sans jeton à
 * faire circuler :
 *
 * - `Origin` présente : elle doit être celle de `PUBLIC_URL` ;
 * - sinon `Referer` présent : même exigence sur son origine ;
 * - ni l'un ni l'autre : acceptée seulement **sans cookie de session** — un
 *   client hors navigateur (jeton de service, `curl` de la porte de secours)
 *   n'a pas d'autorité ambiante à détourner ;
 * - un jeton de service (`Authorization`) sans cookie passe toujours : le
 *   navigateur d'une victime ne peut pas le forger.
 *
 * En développement, les origines de bouclage en HTTP (serveur Vite sur un
 * autre port) sont acceptées en plus.
 */
export function isSameOriginWrite(
  req: Pick<Request, 'method' | 'headers'> & { cookies?: unknown },
  config: Pick<AppConfig, 'PUBLIC_URL' | 'isDev'>,
): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const hasSession = typeof cookies[SESSION_COOKIE] === 'string';
  if (!hasSession && typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0) return true;

  const expected = new URL(config.PUBLIC_URL).origin;
  const header = req.headers.origin ?? (typeof req.headers.referer === 'string' ? req.headers.referer : undefined);
  if (header === undefined) return !hasSession;
  const origin = originOf(header);
  if (origin === null) return false;
  if (origin === expected) return true;
  return config.isDev && isLoopbackOrigin(origin);
}

/** Garde globale des écritures, posée avant le routage de Nest. */
export function csrfOriginMiddleware(config: Pick<AppConfig, 'PUBLIC_URL' | 'isDev'>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (isSameOriginWrite(req, config)) {
      next();
      return;
    }
    res.status(403).json({ error: { code: 'forbidden', message: CSRF_MESSAGE } });
  };
}
