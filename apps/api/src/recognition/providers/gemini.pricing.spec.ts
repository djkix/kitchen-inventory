import { afterEach, describe, expect, it } from 'vitest';
import {
  countSearchQueries,
  DEFAULT_SEARCH_COST_USD_PER_1K,
  estimateCostCents,
  setSearchCostUsdPer1k,
  unpricedModelWarning,
} from './gemini.provider.js';

describe('unpricedModelWarning', () => {
  it('ne dit rien pour un modèle tarifé', () => {
    expect(unpricedModelWarning('gemini', 'gemini-3.5-pro')).toBeNull();
  });

  it('ne dit rien quand aucun modèle n’est imposé : le défaut du fournisseur est tarifé', () => {
    expect(unpricedModelWarning('gemini', undefined)).toBeNull();
  });

  it('nomme le modèle et la conséquence quand il est absent de la table', () => {
    const warning = unpricedModelWarning('gemini', 'gemini-4-ultra');
    expect(warning).toContain('gemini-4-ultra');
    expect(warning).toMatch(/plafond mensuel/i);
    expect(warning).toContain('VISION_MONTHLY_CAP_CENTS');
    // La conséquence exacte : aucun appel chiffré, donc rien de compté.
    expect(estimateCostCents('gemini-4-ultra', { promptTokenCount: 1000, candidatesTokenCount: 1000 })).toBeNull();
  });

  it('se tait pour un autre fournisseur, qui a son propre barème', () => {
    expect(unpricedModelWarning('anthropic', 'claude-inconnu')).toBeNull();
    expect(unpricedModelWarning('none', undefined)).toBeNull();
  });
});

describe('coût des recherches web', () => {
  // Google facture la recherche par requête exécutée, à part des jetons : la
  // compter est ce qui rend le plafond mensuel (VISION_MONTHLY_CAP_CENTS)
  // honnête dès que la recherche est active.
  afterEach(() => setSearchCostUsdPer1k(DEFAULT_SEARCH_COST_USD_PER_1K));

  it('compte les requêtes exécutées, tous candidats confondus', () => {
    expect(
      countSearchQueries({
        candidates: [
          { groundingMetadata: { webSearchQueries: ['recette tomate', 'pâtes tomate'] } },
          { groundingMetadata: { webSearchQueries: ['sauce'] } },
        ],
      }),
    ).toBe(3);
  });

  it('ne compte rien quand le modèle n’a pas cherché', () => {
    expect(countSearchQueries({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })).toBe(0);
    expect(countSearchQueries({})).toBe(0);
  });

  it('ajoute le coût des recherches à celui des jetons', () => {
    const sansRecherche = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 1000 });
    const avecRecherche = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 1000 }, 4);
    // 4 requêtes à 35 $/1000 = 0,14 $ = 14 centimes, très au-dessus des jetons.
    expect(avecRecherche! - sansRecherche!).toBeCloseTo(14, 6);
  });

  it('compte les recherches même pour un modèle absent de la table de prix', () => {
    // Sans cela, un modèle inconnu laisserait filer toute la dépense de
    // recherche sous un plafond qui annonce protéger le budget.
    expect(estimateCostCents('gemini-inconnu', { promptTokenCount: 1000 }, 2)).toBeCloseTo(7, 6);
  });

  it('suit le tarif configuré plutôt qu’un prix figé dans le code', () => {
    setSearchCostUsdPer1k(10);
    expect(estimateCostCents('gemini-3.5-flash-lite', undefined, 1000)).toBeCloseTo(1000, 6);
  });
});
