import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';

/** Section 10 : en-tête noindex sur toutes les réponses, l'application étant publiée sur Internet. */
export function noindexMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}

/** Google Identity Services : script, feuille de style, iframe du bouton et appels (D1 de la connexion Google). */
const GOOGLE_GSI = 'https://accounts.google.com/gsi/';

/**
 * Politique de sécurité du contenu, tirée de ce que le front charge vraiment
 * (revue de sécurité du 2026-10-22) :
 *
 * - tout le code et les médias viennent de l'application elle-même — les
 *   photos de produits sont recopiées par l'API, jamais lues chez Open Food
 *   Facts par le navigateur ;
 * - `'wasm-unsafe-eval'` : le décodeur de codes-barres de repli
 *   (`zxing-wasm`) compile son binaire WebAssembly, servi par l'application ;
 * - Google Identity Services : `gsi/client` (script), `gsi/style`, l'iframe
 *   du bouton et ses appels, tous sous `accounts.google.com/gsi/` ;
 * - `'unsafe-inline'` pour les styles seulement : React pose des attributs
 *   `style` (indentation des emplacements) et le script de Google injecte les
 *   siens ; aucun script en ligne n'est autorisé ;
 * - `blob:` et `data:` pour les aperçus de photo et l'enregistrement vocal.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${GOOGLE_GSI}client`,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_GSI}style`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' ${GOOGLE_GSI}`,
  `frame-src ${GOOGLE_GSI}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Caméra (scan) et micro (demande parlée) pour l'application seule ; le reste fermé. */
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()';

/**
 * En-têtes de sécurité posés sur toutes les réponses, front compilé compris
 * (servi par la même application Express). HSTS seulement quand
 * `PUBLIC_URL` est en HTTPS : posé sur un accès en clair, il n'aurait pas
 * d'effet, et en développement il collerait au navigateur pour `localhost`.
 */
export function securityHeadersMiddleware(config: Pick<AppConfig, 'PUBLIC_URL'>): (req: Request, res: Response, next: NextFunction) => void {
  const hsts = new URL(config.PUBLIC_URL).protocol === 'https:';
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}
