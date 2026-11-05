import { describe, expect, it } from 'vitest';
import { SUGGESTION_INGREDIENT_LENGTH_MAX } from '../rules/suggestion-ingredients.js';
import {
  modelBatchSchema,
  modelRecipeSchema,
  suggestionQuerySchema,
  SUGGESTION_PAGE_MAX,
  SUGGESTION_REGIONS,
  voiceAudioRejection,
  voiceModelBatchSchema,
  VOICE_HEARD_INGREDIENTS_MAX,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_MIN_BYTES,
} from './suggestions.js';

const recette = {
  title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne',
  totalMinutes: 25, prepMinutes: 10, cookMinutes: 15, difficulty: 'EASY', dishType: 'MAIN', provenance: 'web',
  sourceUrl: 'https://exemple.test/pates', steps: [],
  ingredients: [{ label: 'spaghettis', quantity: 200, unit: 'GRAM' }],
};

describe('modelRecipeSchema', () => {
  it('accepte une recette web complète', () => {
    expect(modelRecipeSchema.parse(recette).title).toBe('Pâtes à la tomate');
  });
  it('refuse une URL qui n’est pas en HTTPS (vigilance 2)', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: 'http://exemple.test/x' }).success).toBe(false);
  });
  it('exige une URL pour une recette web, jamais pour une composition', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: null }).success).toBe(false);
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: ['Cuire'] }).success).toBe(true);
  });
  it('exige des étapes pour une composition, qui en dispose déjà', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: [] }).success).toBe(false);
  });
  it('refuse un libellé d’ingrédient vide', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: '  ', quantity: null, unit: null }] }).success).toBe(false);
  });
  it('accepte une quantité absente : « une pincée » existe', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: 'persil', quantity: null, unit: null }] }).success).toBe(true);
  });
  it('accepte une URL https écrite en majuscules (test insensible à la casse)', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: 'HTTPS://EXEMPLE.TEST/pates' }).success).toBe(true);
  });
  it('accepte des durées de préparation et de cuisson séparées', () => {
    const recipe = { ...recette, prepMinutes: 10, cookMinutes: 25 };
    expect(modelRecipeSchema.parse(recipe).cookMinutes).toBe(25);
  });
  it('accepte une recette sans détail de durée : seul le total est exigé', () => {
    // Une salade n'a pas de cuisson ; le modèle doit pouvoir le dire par `null`
    // plutôt que d'inventer un zéro qui se lirait « cuisson : 0 minute ».
    const recipe = { ...recette, prepMinutes: null, cookMinutes: null };
    expect(modelRecipeSchema.safeParse(recipe).success).toBe(true);
  });
});

describe('modelBatchSchema : validation recette par recette', () => {
  it('garde les recettes valides et écarte la seule entrée mal formée', () => {
    const result = modelBatchSchema.safeParse({
      recipes: [recette, { ...recette, sourceUrl: 'http://exemple.test/x' }, { ...recette, title: 'Deuxième' }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.recipes.map((r) => r.title)).toEqual(['Pâtes à la tomate', 'Deuxième']);
  });
  it('accepte une recette web dont l’URL est en HTTPS majuscule', () => {
    const result = modelBatchSchema.safeParse({ recipes: [{ ...recette, sourceUrl: 'HTTPS://exemple.test/pates' }] });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toHaveLength(1);
  });
  it('écarte une recette « ai » qui porte malgré tout une URL, sans perdre les autres', () => {
    const result = modelBatchSchema.safeParse({
      recipes: [{ ...recette, provenance: 'ai', steps: ['Cuire'] }, recette],
    });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toHaveLength(1);
  });
  it('échoue quand aucune entrée ne tient debout', () => {
    expect(modelBatchSchema.safeParse({ recipes: [{ title: 'rien' }, { nope: true }] }).success).toBe(false);
  });
  it('accepte un lot vide : « je ne propose rien » est une réponse', () => {
    const result = modelBatchSchema.safeParse({ recipes: [] });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toEqual([]);
  });
});

describe('suggestionQuerySchema', () => {
  it('accepte une orientation vide', () => {
    expect(suggestionQuerySchema.parse({})).toEqual({ refresh: false });
  });
  it('accepte les trois dimensions ensemble (B9)', () => {
    const q = suggestionQuerySchema.parse({ region: 'asiatique', maxMinutes: '30', difficulty: 'EASY' });
    expect(q).toMatchObject({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });
  it('refuse une durée hors des paliers', () => {
    expect(suggestionQuerySchema.safeParse({ maxMinutes: '42' }).success).toBe(false);
  });
  it('ne prend pas la chaîne « false » pour un vrai (défaut de z.coerce.boolean)', () => {
    expect(suggestionQuerySchema.parse({ refresh: 'false' }).refresh).toBe(false);
    expect(suggestionQuerySchema.parse({ refresh: 'true' }).refresh).toBe(true);
    expect(suggestionQuerySchema.parse({}).refresh).toBe(false);
  });
  it('refuse une valeur de refresh qui n’est ni « true » ni « false »', () => {
    expect(suggestionQuerySchema.safeParse({ refresh: 'oui' }).success).toBe(false);
  });
  it('refuse une région inconnue', () => {
    expect(suggestionQuerySchema.safeParse({ region: 'martienne' }).success).toBe(false);
  });
  it('borne la page demandée, et refuse tout ce qui sort de la borne', () => {
    // Une limite libre venue du client ferait calculer la couverture sur tout
    // le réservoir : le rapprochement `pg_trgm` se paie par libellé
    // d'ingrédient, sur une petite machine (2026-10-19).
    expect(suggestionQuerySchema.parse({ limit: '36' }).limit).toBe(36);
    expect(suggestionQuerySchema.parse({ limit: String(SUGGESTION_PAGE_MAX) }).limit).toBe(SUGGESTION_PAGE_MAX);
    expect(suggestionQuerySchema.safeParse({ limit: String(SUGGESTION_PAGE_MAX + 1) }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ limit: '10000' }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ limit: '12.5' }).success).toBe(false);
  });
  it('laisse la limite absente : le serveur pose alors la page par défaut', () => {
    expect(suggestionQuerySchema.parse({}).limit).toBeUndefined();
  });
  it('rend les ingrédients dictés normalisés et triés (D3, D7)', () => {
    // Triés au schéma, donc une seule fois : la signature de l'orientation les
    // reprend tels quels, et deux saisies de même contenu sont la même demande.
    expect(suggestionQuerySchema.parse({ ingredients: 'Merguez, Pommes de terre' }).ingredients?.terms).toEqual(['merguez', 'pommes de terre']);
    expect(suggestionQuerySchema.parse({ ingredients: 'pommes de terre, merguez' }).ingredients?.terms).toEqual(['merguez', 'pommes de terre']);
  });
  it('traite une saisie vide comme une absence de contrainte, jamais comme une contrainte vide (D7)', () => {
    expect(suggestionQuerySchema.parse({ ingredients: '  ' }).ingredients?.terms).toEqual([]);
    // Une saisie faite de virgules seules n'est pas une contrainte non plus.
    expect(suggestionQuerySchema.parse({ ingredients: ' , ,, ' }).ingredients?.terms).toEqual([]);
    expect(suggestionQuerySchema.parse({}).ingredients).toBeUndefined();
  });
  it('garde la saisie telle quelle à côté des termes normalisés (tour 1)', () => {
    // Le prompt doit recevoir « crème fraîche » accentué : la normalisation
    // sert la signature et le rapprochement, jamais le transport au modèle.
    const parsed = suggestionQuerySchema.parse({ ingredients: 'Crème fraîche, Merguez' });
    expect(parsed.ingredients?.raw).toBe('Crème fraîche, Merguez');
    expect(parsed.ingredients?.terms).toEqual(['creme fraiche', 'merguez']);
  });
  it('borne la saisie à cinq ingrédients de trente caractères (D7)', () => {
    expect(suggestionQuerySchema.safeParse({ ingredients: 'a, b, c, d, e' }).success).toBe(true);
    expect(suggestionQuerySchema.safeParse({ ingredients: 'a, b, c, d, e, f' }).success).toBe(false);
    expect(suggestionQuerySchema.safeParse({ ingredients: 'x'.repeat(SUGGESTION_INGREDIENT_LENGTH_MAX) }).success).toBe(true);
    expect(suggestionQuerySchema.safeParse({ ingredients: 'x'.repeat(SUGGESTION_INGREDIENT_LENGTH_MAX + 1) }).success).toBe(false);
  });
  it('expose sept régions, sans doublon', () => {
    expect(new Set(SUGGESTION_REGIONS).size).toBe(SUGGESTION_REGIONS.length);
  });
});

/**
 * Demande parlée (spécification du 2026-10-21) : un seul appel rend la lecture
 * de la phrase ET les recettes (D2, D4).
 */
describe('voiceModelBatchSchema (demande parlée, D2, D4)', () => {
  it('rend ce que le modèle a entendu à côté des recettes', () => {
    const parsed = voiceModelBatchSchema.parse({
      heard: { ingredients: ['poulet', 'sauce tomate'], orientation: 'plat italien' },
      recipes: [recette],
    });
    expect(parsed.heard.ingredients).toEqual(['poulet', 'sauce tomate']);
    expect(parsed.heard.orientation).toBe('plat italien');
    expect(parsed.recipes).toHaveLength(1);
  });

  it('tient une réponse sans lecture pour une lecture vide, jamais pour une erreur', () => {
    // C'est le service qui décide qu'une lecture vide veut dire « rien
    // compris » (D9) : le schéma ne doit pas perdre les recettes payées.
    const parsed = voiceModelBatchSchema.parse({ recipes: [recette] });
    expect(parsed.heard).toEqual({ ingredients: [], orientation: null });
    expect(parsed.recipes).toHaveLength(1);
  });

  it('écarte les ingrédients vides et borne la lecture', () => {
    const parsed = voiceModelBatchSchema.parse({
      heard: { ingredients: ['  ', 'poulet', ...Array.from({ length: 30 }, (_, i) => `x${i}`)], orientation: '   ' },
      recipes: [recette],
    });
    expect(parsed.heard.ingredients).not.toContain('');
    expect(parsed.heard.ingredients.length).toBeLessThanOrEqual(VOICE_HEARD_INGREDIENTS_MAX);
    expect(parsed.heard.ingredients[0]).toBe('poulet');
    // Une orientation faite d'espaces n'est pas une orientation.
    expect(parsed.heard.orientation).toBeNull();
  });

  it('garde les recettes valides et écarte la seule mal formée, comme le lot écrit', () => {
    const parsed = voiceModelBatchSchema.parse({
      heard: { ingredients: ['poulet'], orientation: null },
      recipes: [recette, { ...recette, sourceUrl: 'http://pas-https.test/x' }],
    });
    expect(parsed.recipes).toHaveLength(1);
  });

  it('refuse un lot dont aucune recette ne tient debout', () => {
    expect(voiceModelBatchSchema.safeParse({ heard: { ingredients: [], orientation: null }, recipes: [{ title: 'rien' }] }).success).toBe(false);
  });
});

/**
 * Bornes de l'enregistrement (D8). Une seule implémentation, partagée par
 * l'écran et par le serveur : un client n'est jamais une garantie, mais les
 * deux doivent refuser pour la même raison et avec la même phrase.
 */
describe('voiceAudioRejection (D8, D9)', () => {
  const ok = VOICE_MIN_BYTES + 1;

  it('accepte un enregistrement dans les bornes', () => {
    expect(voiceAudioRejection(ok, 'audio/webm;codecs=opus')).toBeNull();
    expect(voiceAudioRejection(VOICE_MAX_BYTES, 'audio/mp4')).toBeNull();
  });

  it('refuse un enregistrement vide, et le dit', () => {
    expect(voiceAudioRejection(0, 'audio/webm')).toMatch(/vide/i);
    expect(voiceAudioRejection(VOICE_MIN_BYTES - 1, 'audio/webm')).toMatch(/vide/i);
  });

  it('refuse un enregistrement au-delà de la taille maximale', () => {
    const message = voiceAudioRejection(VOICE_MAX_BYTES + 1, 'audio/webm');
    expect(message).toMatch(/trop long|trop volumineux/i);
    // La borne de durée est dite à l'utilisateur : une taille en octets ne
    // veut rien dire pour qui vient de parler dans un micro.
    expect(message).toContain(String(VOICE_MAX_SECONDS));
  });

  it('refuse un format que le modèle ne sait pas lire', () => {
    expect(voiceAudioRejection(ok, 'video/mp4')).toMatch(/format/i);
    expect(voiceAudioRejection(ok, 'text/plain')).toMatch(/format/i);
  });

  it('ignore les paramètres de codec et la casse du type', () => {
    expect(voiceAudioRejection(ok, 'AUDIO/WEBM; codecs=opus')).toBeNull();
  });
});
