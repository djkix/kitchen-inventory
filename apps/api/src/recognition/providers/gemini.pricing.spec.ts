import { describe, expect, it } from 'vitest';
import { countSearchQueries, estimateCostCents, PRICES_USD_PER_MTOK, unpricedModelWarning } from './gemini.provider.js';

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
    expect(unpricedModelWarning('none', 'un-modele-quelconque')).toBeNull();
    expect(unpricedModelWarning('none', undefined)).toBeNull();
  });
});

describe('coût des recherches web', () => {
  // Google facture la recherche par requête exécutée, à part des jetons : la
  // compter est ce qui rend le plafond mensuel (VISION_MONTHLY_CAP_CENTS)
  // honnête dès que la recherche est active.
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

  it('chiffre les recherches même sans aucun jeton consommé', () => {
    // 1000 requêtes à 35 $/1000 = 35 $ = 3500 centimes.
    expect(estimateCostCents('gemini-3.5-flash-lite', undefined, 1000)).toBeCloseTo(3500, 6);
  });
});

/**
 * Entrée audio (spécification du 2026-10-21, D7). L'audio coûte davantage que
 * le texte — de l'ordre du triple pour Flash-Lite. Sans ce poste, le plafond
 * mensuel sous-compterait en silence, exactement comme il le faisait pour les
 * requêtes de recherche web avant la 0.12.0.
 */
describe('coût de l’entrée audio (D7, 2026-10-21)', () => {
  it('tarife l’audio plus cher que le texte pour chaque modèle de la table', () => {
    for (const [model, price] of Object.entries(PRICES_USD_PER_MTOK)) {
      expect(price.audio, model).toBeGreaterThanOrEqual(price.input);
    }
    // Flash-Lite est le modèle de suggestions par défaut : son tarif audio ne
    // doit surtout pas retomber sur son tarif texte.
    expect(PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!.audio).toBeGreaterThan(PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!.input);
  });

  it('s’appuie sur la ventilation par modalité quand l’API la rend', () => {
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents(
      'gemini-3.5-flash-lite',
      { promptTokenCount: 1000, candidatesTokenCount: 0, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 400 }, { modality: 'AUDIO', tokenCount: 600 }] },
      0,
      true,
    );
    expect(cost).toBeCloseTo(((400 * price.input + 600 * price.audio) / 1_000_000) * 100, 8);
  });

  it('facture TOUT au tarif audio quand la ventilation est absente', () => {
    // Mieux vaut surestimer un plafond de protection que le laisser mentir
    // (D7) : c'est ce repli qui empêche le sous-comptage silencieux.
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 0 }, 0, true);
    expect(cost).toBeCloseTo((1000 * price.audio) / 1_000_000 * 100, 8);
    // Et c'est bien plus cher que ce que l'ancien calcul aurait compté.
    expect(cost!).toBeGreaterThan(((1000 * price.input) / 1_000_000) * 100);
  });

  it('ne facture jamais un appel sans audio au tarif audio', () => {
    // Le scan photo et la recherche de recettes écrites ne doivent pas se
    // mettre à coûter trois fois plus parce que l'audio existe ailleurs.
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 0 });
    expect(cost).toBeCloseTo(((1000 * price.input) / 1_000_000) * 100, 8);
  });

  it('facture au tarif texte la part non audio annoncée par la ventilation', () => {
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    // Ventilation partielle : 300 jetons audio annoncés sur 1000 consommés,
    // les 700 restants sont du texte et non de l'audio.
    const cost = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 300 }] }, 0, true);
    expect(cost).toBeCloseTo(((700 * price.input + 300 * price.audio) / 1_000_000) * 100, 8);
  });
});

/**
 * Le trou relevé en revue (tour de correction 1) : la ventilation existe,
 * mais elle ne dit rien de l'audio. C'est le cas le plus probable des deux —
 * une API qui renvoie ce champ le renvoie en général rempli de quelque chose.
 */
describe('ventilation présente mais muette sur l’audio (D7, tour 1)', () => {
  it('facture au tarif audio une ventilation qui ne porte aucune ligne AUDIO', () => {
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents(
      'gemini-3.5-flash-lite',
      { promptTokenCount: 1000, candidatesTokenCount: 0, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1000 }] },
      0,
      true,
    );
    expect(cost).toBeCloseTo(((1000 * price.audio) / 1_000_000) * 100, 8);
    // Le défaut exact qu'il s'agit d'empêcher : le tiers du prix, sans un mot.
    expect(cost).not.toBeCloseTo(((1000 * price.input) / 1_000_000) * 100, 8);
  });

  it('reconnaît la ligne audio quelle que soit la casse rendue par l’API', () => {
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents(
      'gemini-3.5-flash-lite',
      { promptTokenCount: 1000, candidatesTokenCount: 0, promptTokensDetails: [{ modality: 'audio', tokenCount: 200 }] },
      0,
      true,
    );
    expect(cost).toBeCloseTo(((800 * price.input + 200 * price.audio) / 1_000_000) * 100, 8);
  });

  it('ne facture toujours pas au tarif audio un appel qui n’en porte pas', () => {
    const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
    const cost = estimateCostCents('gemini-3.5-flash-lite', { promptTokenCount: 1000, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1000 }] });
    expect(cost).toBeCloseTo(((1000 * price.input) / 1_000_000) * 100, 8);
  });
});
