import type { NextFunction, Request, Response } from 'express';

/** Section 10 : en-tête noindex sur toutes les réponses, l'application étant publiée sur Internet. */
export function noindexMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}
