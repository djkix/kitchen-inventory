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
 *
 * **L'ordre a été inversé le 2026-11-20, puis remis le jour même.** Le motif
 * de l'inversion était la qualité des recettes, et il était juste ; la
 * prémisse qu'elle supposait — qu'un Flash répondrait — était fausse. Le
 * journal complet, relevé en production après coup, ne laissait aucune place
 * au doute :
 *
 * | modèle | 200 | 503 | sans statut | durée moyenne |
 * | --- | --- | --- | --- | --- |
 * | 3.8-flash | **0** | 7 | 10 | 6,4 s / 45 s |
 * | 3.7-flash | **0** | 5 | 2 | 7,7 s / 120 s |
 * | 3.6-flash | **0** | 3 | 2 | 8,4 s / 45 s |
 * | 3.5-flash | 1 | 3 | 0 | 70,3 s |
 * | **3.5-flash-lite** | **21** | 1 | 0 | **7,1 s** |
 *
 * Une réussite en trente-quatre tentatives côté Flash, et elle a demandé
 * soixante-dix secondes. Les Flash-Lite : vingt et une sur vingt-deux, en sept
 * secondes. Sur le palier gratuit de l'API, les Flash ne sont pas lents, ils
 * sont inaccessibles.
 *
 * Le prix de l'erreur s'est vu à l'écran : la cascade enchaînait les refus et
 * le mandataire inverse coupait la connexion à **90 secondes** — une borne que
 * l'application ne connaît pas et que `GENERATION_TIMEOUT_MS` (120 s) ne peut
 * donc pas respecter. L'utilisateur recevait « Erreur du serveur ».
 *
 * La qualité des recettes reste cherchée, mais par la consigne seule
 * (`suggestions/prompt.ts`), qui ne coûte ni attente ni disponibilité.
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

/**
 * Niveau de réflexion demandé au modèle (2026-11-25).
 *
 * Les modèles Gemini 3 réfléchissent **à « high » par défaut**. Personne ne
 * l'avait réglé, et cela se payait deux fois : à l'écran, vingt à quarante
 * secondes d'attente pour une seule recette sur un appel pourtant réussi ; et
 * sur le plafond mensuel, puisque les jetons de réflexion sont facturés comme
 * de la sortie.
 *
 * « low » et non « minimal » : `MINIMAL` est refusé par validation sur les
 * Flash les plus récents (3.8), et la cascade prend ses modèles dans la liste
 * en direct de Google — une valeur qui marche sur l'un et fait tomber l'autre
 * serait une panne différée. « low » est accepté par toute la famille 3.
 *
 * La famille 2 ne connaît pas `thinkingLevel` mais `thinkingBudget`, dont le
 * zéro coupe la réflexion. Aucun modèle 2 n'est en service aujourd'hui ; la
 * liste venant de Google, la branche est là pour le jour où il en reparaîtrait
 * un.
 *
 * Composer une recette ne demande pas de réflexion poussée : la qualité est
 * portée par la consigne (`suggestions/prompt.ts`), qui ne coûte ni attente ni
 * jetons de sortie.
 */
export function thinkingConfigFor(model: string): { thinkingLevel: string } | { thinkingBudget: number } | undefined {
  const match = STABLE.exec(model);
  if (!match) return undefined;
  const major = Number(match[1]!.split('.')[0]);
  if (major >= 3) return { thinkingLevel: 'LOW' };
  if (major === 2) return { thinkingBudget: 0 };
  return undefined;
}
