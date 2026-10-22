/**
 * Modèle léger : Flash ou Flash-Lite, jamais Pro. Le nom part
 * dans une adresse Google, d'où les caractères limités.
 */
export const isLightModel = (model: string): boolean => /^[a-z0-9.-]+$/i.test(model) && /flash|lite/i.test(model) && !/pro/i.test(model);

/** `gemini-3.8-flash`, `gemini-3.5-flash-lite` : écarte alias, aperçus, instantanés et familles spécialisées. */
const STABLE = /^gemini-(\d+(?:\.\d+)*)-flash(-lite)?$/;
export const isStableModel = (name: string): boolean => STABLE.test(name) && isLightModel(name);

/** Ordre d'emploi : du plus récent au plus ancien, Flash avant Flash-Lite à version égale. */
export function orderModels(available: readonly string[]): string[] {
  const rank = (m: string) => {
    const [, v, lite] = STABLE.exec(m)!;
    return { v: v!.split('.').map(Number), lite: lite ? 1 : 0 };
  };
  return [...new Set(available)].filter(isStableModel).sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < Math.max(ra.v.length, rb.v.length); i++) {
      const d = (rb.v[i] ?? 0) - (ra.v[i] ?? 0);
      if (d) return d;
    }
    return ra.lite - rb.lite;
  });
}
