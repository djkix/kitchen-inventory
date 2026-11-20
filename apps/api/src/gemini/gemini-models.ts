/**
 * Modèle léger : Flash ou Flash-Lite, jamais Pro. Le nom part
 * dans une adresse Google, d'où les caractères limités.
 */
export const isLightModel = (model: string): boolean => /^[a-z0-9.-]+$/i.test(model) && /flash|lite/i.test(model) && !/pro/i.test(model);

/** `gemini-3.8-flash`, `gemini-3.5-flash-lite` : écarte alias, aperçus, instantanés et familles spécialisées. */
const STABLE = /^gemini-(\d+(?:\.\d+)*)-flash(-lite)?$/;
export const isStableModel = (name: string): boolean => STABLE.test(name) && isLightModel(name);

/**
 * Ordre d'emploi : **les Flash d'abord**, du plus récent au plus ancien, puis
 * les Flash-Lite de la même façon.
 *
 * L'ordre a été inversé deux fois, pour deux raisons qui ne se contredisent
 * pas. Le 2026-11-09, les Flash-Lite sont passés devant parce qu'eux seuls
 * répondaient : relevé en production sur une demande parlée, cinq refus avant
 * la première réponse.
 *
 * | 3.8-flash | 503 | 3,8 s |
 * | 3.7-flash | 503 | 1,6 s |
 * | 3.6-flash | 503 | 5,2 s |
 * | 3.7-flash | délai dépassé | 120,0 s |
 * | 3.5-flash | 503 | 18,8 s |
 * | **3.5-flash-lite** | **200** | **3,7 s** |
 *
 * Le 2026-11-20, le propriétaire a constaté le prix de ce choix : les 399
 * recettes du réservoir, toutes composées par `gemini-3.5-flash-lite`,
 * faisaient en moyenne 3,5 ingrédients et 4,3 étapes, là où le même modèle
 * haut de gamme interrogé à la main rend des plats structurés. Composer une
 * recette n'est pas la tâche simple qu'on croyait : c'est la seule de
 * l'application dont la **qualité** se voit, et Flash-Lite est le modèle le
 * plus faible de la liste.
 *
 * La cascade rend l'inversion sans risque : un 503 écarte le modèle cinq
 * minutes et passe au suivant, donc les Flash-Lite restent derrière, prêts à
 * répondre le jour où les Flash saturent. Le seul coût est l'attente — 65 s
 * contre 3,7 s au relevé du 2026-11-09 — devenue supportable depuis la
 * notification de résultat (EF-31), qui laisse quitter l'écran.
 */
export function orderModels(available: readonly string[]): string[] {
  const rank = (m: string) => {
    const [, v, lite] = STABLE.exec(m)!;
    return { v: v!.split('.').map(Number), lite: lite ? 1 : 0 };
  };
  return [...new Set(available)].filter(isStableModel).sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    // La famille d'abord : tous les Flash avant tous les Flash-Lite.
    if (ra.lite !== rb.lite) return ra.lite - rb.lite;
    for (let i = 0; i < Math.max(ra.v.length, rb.v.length); i++) {
      const d = (rb.v[i] ?? 0) - (ra.v[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
}
