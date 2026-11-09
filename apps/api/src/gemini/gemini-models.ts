/**
 * Modèle léger : Flash ou Flash-Lite, jamais Pro. Le nom part
 * dans une adresse Google, d'où les caractères limités.
 */
export const isLightModel = (model: string): boolean => /^[a-z0-9.-]+$/i.test(model) && /flash|lite/i.test(model) && !/pro/i.test(model);

/** `gemini-3.8-flash`, `gemini-3.5-flash-lite` : écarte alias, aperçus, instantanés et familles spécialisées. */
const STABLE = /^gemini-(\d+(?:\.\d+)*)-flash(-lite)?$/;
export const isStableModel = (name: string): boolean => STABLE.test(name) && isLightModel(name);

/**
 * Ordre d'emploi : **les Flash-Lite d'abord**, du plus récent au plus ancien,
 * puis les Flash de la même façon.
 *
 * L'ordre était l'inverse — le plus récent et le plus gros en tête — et il
 * coûtait cher. Relevé sur le serveur de production le 2026-11-09, une seule
 * demande parlée :
 *
 * | 3.8-flash | 503 | 3,8 s |
 * | 3.7-flash | 503 | 1,6 s |
 * | 3.6-flash | 503 | 5,2 s |
 * | 3.7-flash | délai dépassé | 120,0 s |
 * | 3.5-flash | 503 | 18,8 s |
 * | **3.5-flash-lite** | **200** | **3,7 s** |
 *
 * Google sature ses modèles récents pour le trafic API gratuit ; Flash-Lite,
 * lui, répond. Deux minutes d'attente pour une réponse que le dernier de la
 * liste rendait en moins de quatre secondes.
 *
 * Choix du propriétaire le 2026-11-09 : « prends les modèles Flash-Lite en
 * premier puisque ce sont ceux qui répondent le mieux, la demande est simple
 * et ne demande pas de gros modèle. » Composer trois recettes à partir d'une
 * liste d'ingrédients ne réclame pas le modèle le plus capable, mais celui qui
 * répond — et la cascade garde les Flash derrière, pour le jour où les
 * Flash-Lite refuseraient à leur tour.
 */
export function orderModels(available: readonly string[]): string[] {
  const rank = (m: string) => {
    const [, v, lite] = STABLE.exec(m)!;
    return { v: v!.split('.').map(Number), lite: lite ? 1 : 0 };
  };
  return [...new Set(available)].filter(isStableModel).sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    // La famille d'abord : tous les Flash-Lite avant tous les Flash.
    if (ra.lite !== rb.lite) return rb.lite - ra.lite;
    for (let i = 0; i < Math.max(ra.v.length, rb.v.length); i++) {
      const d = (rb.v[i] ?? 0) - (ra.v[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
}
