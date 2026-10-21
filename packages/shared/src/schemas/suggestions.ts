import { z } from 'zod';
import type { CoverageGroup, IngredientState } from '../rules/coverage.js';
import type { MatchState } from '../rules/ingredient-match.js';
import { clientOpIdSchema, idSchema, positiveQuantitySchema, unitSchema } from './common.js';
import {
  normalizeIngredientTerms,
  splitIngredientTerms,
  SUGGESTION_INGREDIENT_LENGTH_MAX,
  SUGGESTION_INGREDIENTS_MAX,
} from '../rules/suggestion-ingredients.js';
import { difficultySchema, dishTypeSchema } from './recipes.js';

/**
 * Régions de cuisine proposées comme orientation de recherche (section 12,
 * EF-25). Pas de région « autre » : une orientation vide équivaut à aucune
 * contrainte, voir `suggestionQuerySchema`.
 */
export const SUGGESTION_REGIONS = [
  'europeenne',
  'mediterraneenne',
  'asiatique',
  'latino-americaine',
  'moyen-orientale',
  'africaine',
  'nord-americaine',
] as const;
export type SuggestionRegion = (typeof SUGGESTION_REGIONS)[number];
export const suggestionRegionSchema = z.enum(SUGGESTION_REGIONS);

export const SUGGESTION_REGION_LABELS_FR: Record<SuggestionRegion, string> = {
  europeenne: 'Européenne',
  mediterraneenne: 'Méditerranéenne',
  asiatique: 'Asiatique',
  'latino-americaine': 'Latino-américaine',
  'moyen-orientale': 'Moyen-orientale',
  africaine: 'Africaine',
  'nord-americaine': 'Nord-américaine',
};

/** Paliers de durée totale proposés comme orientation (B9) : pas de valeur libre. */
export const SUGGESTION_DURATIONS = [15, 30, 60] as const;
export type SuggestionDuration = (typeof SUGGESTION_DURATIONS)[number];

/**
 * Page rendue par défaut quand la requête ne demande rien (section 5.1, B8),
 * et pas de la liste côté écran.
 */
export const SUGGESTION_PAGE_SIZE = 12;

/**
 * Borne haute de la page demandée (2026-10-19).
 *
 * Pourquoi borner : le serveur calcule la couverture sur une fenêtre de
 * classement proportionnelle à la page, et ce calcul est un rapprochement
 * `pg_trgm` par libellé d'ingrédient contre tout le catalogue de produits.
 * Une valeur libre venue du client (`?limit=10000`) ferait donc balayer tout
 * le réservoir à chaque visite, sur un mini-PC, pour un téléphone.
 *
 * Pourquoi cinq pages et pas plus : c'est déjà soixante cartes à faire défiler
 * au doigt — au-delà, l'outil qui sert n'est pas une page plus longue mais les
 * orientations (cuisine, durée, facilité), qui filtrent le réservoir en amont.
 */
export const SUGGESTION_PAGE_MAX = 5 * SUGGESTION_PAGE_SIZE;

/**
 * Ingrédients dictés à la main (spécification du 2026-10-19, D7) : du texte
 * libre séparé par des virgules, borné à cinq termes de trente caractères.
 * Le résultat est normalisé, dédoublonné et **trié** (D3) — c'est cette liste
 * qui entre dans la signature d'orientation, et deux saisies de même contenu
 * doivent y entrer identiques.
 *
 * Les bornes vivent ici et nulle part ailleurs : l'écran valide avec ce même
 * schéma avant d'envoyer quoi que ce soit (jamais deux implémentations).
 * Une saisie vide rend une liste vide, c'est-à-dire aucune contrainte.
 */
export const suggestionIngredientsSchema = z
  .string()
  .superRefine((raw, ctx) => {
    const terms = splitIngredientTerms(raw);
    if (terms.length > SUGGESTION_INGREDIENTS_MAX) {
      ctx.addIssue({ code: 'custom', message: `${SUGGESTION_INGREDIENTS_MAX} ingrédients au maximum` });
    }
    if (terms.some((term) => term.length > SUGGESTION_INGREDIENT_LENGTH_MAX)) {
      ctx.addIssue({ code: 'custom', message: `${SUGGESTION_INGREDIENT_LENGTH_MAX} caractères au maximum par ingrédient` });
    }
  })
  // `raw` ET `terms` (tour de correction 1) : le modèle doit recevoir la
  // saisie telle qu'elle a été tapée — « crème fraîche » accentué — tandis que
  // la signature (D3) et le rapprochement au réservoir (D8) travaillent sur la
  // forme normalisée. La normalisation sert la comparaison, jamais le
  // transport.
  .transform((raw) => ({ raw: raw.trim(), terms: normalizeIngredientTerms(raw) }));
export type SuggestionIngredients = z.infer<typeof suggestionIngredientsSchema>;

export const suggestionQuerySchema = z.object({
  region: suggestionRegionSchema.optional(),
  maxMinutes: z.coerce
    .number()
    .refine((value) => SUGGESTION_DURATIONS.includes(value as SuggestionDuration), {
      message: 'Durée attendue parmi les paliers proposés : 15, 30 ou 60 minutes',
    })
    .optional(),
  difficulty: difficultySchema.optional(),
  /**
   * Type de plat demandé au modèle, et filtre du réservoir à la lecture. C'est
   * une orientation serveur à part entière depuis le 2026-10-11 : il n'y a
   * plus de filtre d'écran local, la recherche est mono-type.
   */
  dishType: dishTypeSchema.optional(),
  /**
   * Relance explicite : demande une nouvelle recherche au modèle au lieu de
   * servir le réservoir (D6, D11) — la seule sortie du verrou de 24 heures
   * posé sur une orientation déjà demandée.
   * Jamais `z.coerce.boolean()` : il rend `true` pour la chaîne `"false"`, si
   * bien qu'un `refresh=false` posé par défaut dans l'orientation ferait payer
   * un appel à chaque chargement. Seule la chaîne `"true"` vaut vrai.
   */
  refresh: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === 'true' || value === true),
  /**
   * Nombre de recettes rendues en une fois. Absent, le serveur pose
   * `SUGGESTION_PAGE_SIZE` ; c'est le bouton « Charger plus » de l'écran qui
   * l'augmente, page par page, jusqu'à `SUGGESTION_PAGE_MAX`. Demander une
   * page plus grande ne déclenche jamais d'appel au modèle : ce déclenchement
   * ne tient qu'au plancher du réservoir et à la relance explicite.
   */
  limit: z.coerce.number().int().min(1).max(SUGGESTION_PAGE_MAX).optional(),
  /**
   * Ingrédients que chaque recette proposée doit utiliser (D1). Ils
   * s'**ajoutent** au point de départ tiré du stock, ils ne le remplacent pas
   * (D4) : le réservoir est filtré dessus, la signature les porte, et le
   * prompt distingue ce qui est imposé de ce qui est simplement disponible.
   */
  ingredients: suggestionIngredientsSchema.optional(),
});
export type SuggestionQuery = z.infer<typeof suggestionQuerySchema>;

const modelRecipeIngredientSchema = z.object({
  label: z.string().trim().min(1, { message: "Libellé d'ingrédient requis" }).max(160),
  // Une quantité absente est légitime (« une pincée », « au goût ») : non manquante, juste non chiffrée.
  quantity: positiveQuantitySchema.nullable(),
  unit: unitSchema.nullable(),
});

const modelRecipeBaseSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  origin: z.string().trim().min(1, { message: 'Origine requise' }).max(120),
  region: suggestionRegionSchema,
  totalMinutes: z.number().int().positive({ message: 'Durée totale requise' }).max(1440),
  /**
   * Préparation et cuisson séparées, `null` quand la recette n'en a pas (une
   * salade n'a pas de cuisson) ou quand le modèle ne les distingue pas. Jamais
   * `0` : zéro minute de cuisson et pas de cuisson ne se lisent pas pareil.
   * `totalMinutes` reste la durée de référence affichée sur les cartes.
   */
  prepMinutes: z.number().int().positive().max(1440).nullable(),
  cookMinutes: z.number().int().positive().max(1440).nullable(),
  difficulty: difficultySchema,
  /**
   * Entrée, plat, dessert… La taxonomie est celle de `Recipe.dishType` : une
   * suggestion conservée garde son classement sans conversion, et les deux
   * écrans filtrent sur le même vocabulaire.
   */
  dishType: dishTypeSchema,
  provenance: z.enum(['web', 'ai']),
  sourceUrl: z.string().trim().url({ message: 'URL invalide' }).nullable(),
  steps: z.array(z.string().trim().min(1)).max(60),
  ingredients: z.array(modelRecipeIngredientSchema).min(1, { message: 'Au moins un ingrédient requis' }).max(60),
});

/**
 * Recette telle que rendue par le modèle, avant tout rapprochement avec le
 * stock. Porte les deux règles croisées de la vigilance 2 : une recette `web`
 * ne vaut que par son lien source, une composition `ai` n'a de légitimité que
 * par ses étapes et ne doit jamais prétendre venir d'ailleurs.
 */
export const modelRecipeSchema = modelRecipeBaseSchema.superRefine((recipe, ctx) => {
  if (recipe.provenance === 'web') {
    // Test insensible à la casse : `HTTPS://…` est une URL https valide, le
    // rejeter faisait tomber la recette (et, avant la validation recette par
    // recette ci-dessous, le lot entier avec elle).
    const isHttps = recipe.sourceUrl !== null && /^https:\/\//i.test(recipe.sourceUrl);
    if (!isHttps) {
      ctx.addIssue({
        code: 'custom',
        message: 'Une recette trouvée sur le web exige une URL source en https',
        path: ['sourceUrl'],
      });
    }
  } else {
    if (recipe.sourceUrl !== null) {
      ctx.addIssue({
        code: 'custom',
        message: "Une composition du modèle ne porte pas d'URL source",
        path: ['sourceUrl'],
      });
    }
    if (recipe.steps.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Une composition du modèle exige au moins une étape',
        path: ['steps'],
      });
    }
  }
});
export type ModelRecipe = z.infer<typeof modelRecipeSchema>;

/**
 * Réponse brute attendue du fournisseur de suggestions (Gemini, retenu).
 * Pas de borne haute ici : la taille du lot est décidée par `SuggestionRequest.count`
 * au moment de l'appel (huit recettes web et quatre composées, dosage ajustable),
 * pas par une limite arbitraire sur la forme validée.
 *
 * Validation **recette par recette** : les entrées arrivent non typées et sont
 * validées une à une, les valides étant conservées et les autres écartées en
 * silence. Un tableau validé d'un bloc faisait échouer le lot entier — donc une
 * reprise, donc un second appel payant, puis `provider_unavailable` et un écran
 * en erreur — pour une seule recette sur seize mal formée.
 */
export const modelBatchSchema = z
  .object({ recipes: z.array(z.unknown()) })
  .transform((batch, ctx) => {
    const kept: ModelRecipe[] = [];
    for (const entry of batch.recipes) {
      const parsed = modelRecipeSchema.safeParse(entry);
      if (parsed.success) kept.push(parsed.data);
    }
    // Un lot vide est une réponse légitime (« je ne propose rien ») ; un lot
    // dont *aucune* entrée ne tient debout, non : c'est une réponse à reprendre.
    if (batch.recipes.length > 0 && kept.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Aucune recette exploitable dans le lot rendu par le modèle',
        path: ['recipes'],
      });
      return z.NEVER;
    }
    return { recipes: kept };
  });
export type ModelBatch = z.infer<typeof modelBatchSchema>;

/**
 * Conserve une suggestion, pour en faire une recette du foyer.
 *
 * `suggestionId` est l'identité de contenu publiée par la fournée
 * (`suggestionIdentity`) : depuis le réservoir (D9), c'est elle seule qui
 * désigne la recette. `batchId` n'est plus qu'un reliquat du client, accepté
 * et ignoré : il doit donc rester libre, y compris vide — l'écran ne reçoit
 * plus de fournée quand le réservoir sert seul, et un `idSchema` (`min(1)`)
 * refusait alors la conservation en 400, avant même le service.
 */
export const keepSuggestionSchema = z.object({
  batchId: z.string().optional(),
  suggestionId: idSchema,
  clientOpId: clientOpIdSchema.optional(),
});
export type KeepSuggestionInput = z.infer<typeof keepSuggestionSchema>;

const recipeRewriteIngredientSchema = z.object({
  label: z.string().trim().min(1, { message: "Libellé d'ingrédient requis" }).max(160),
  quantity: positiveQuantitySchema.nullable(),
  unit: unitSchema.nullable(),
});

/**
 * Recette telle que rendue par Gemini lors de la réécriture au format de
 * l'application (tâche 9, B6) : pas d'origine ni d'URL ici, portées par la
 * suggestion d'origine, jamais par la réécriture elle-même.
 */
export const recipeRewriteSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  steps: z.array(z.string().trim().min(1)).min(1, { message: 'Au moins une étape' }).max(60),
  ingredients: z.array(recipeRewriteIngredientSchema).min(1, { message: 'Au moins un ingrédient requis' }).max(60),
});
export type RecipeRewrite = z.infer<typeof recipeRewriteSchema>;

export interface SuggestionIngredientDto {
  label: string;
  quantity: number | null;
  unit: z.infer<typeof unitSchema> | null;
  match: MatchState;
  productId: string | null;
  productName: string | null;
  state: IngredientState;
  /** Photo du produit rapproché, pour identifier le contenant d'un coup d'œil ; `null` sans produit. */
  productImagePath: string | null;
  /** Emplacement du lot qui sera consommé en premier ; `null` si l'ingrédient n'est pas en stock. */
  locationName: string | null;
  /** Clé de couleur de la pastille : la température de cet emplacement, `null` si non renseignée. */
  locationTemperature: 'ambient' | 'chilled' | 'frozen' | null;
  /**
   * Ingrédient que l'on vient de déclarer dans le champ de saisie (D5, tour de
   * correction 1 du 2026-10-19). `state` continue de dire ce que le **stock**
   * sait — la règle de couverture partagée n'a pas à connaître une déclaration
   * invérifiable — mais l'écran ne doit jamais afficher « Merguez — Manquant »
   * juste après que Franck ait tapé « merguez ».
   */
  declared: boolean;
}

export interface SuggestionDto {
  id: string;
  title: string;
  origin: string;
  region: SuggestionRegion;
  totalMinutes: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: z.infer<typeof difficultySchema>;
  dishType: z.infer<typeof dishTypeSchema>;
  provenance: 'web' | 'ai';
  sourceUrl: string | null;
  /**
   * Page source lue avec succès à l'ingestion (décision D4 du 2026-10-15).
   * Toujours `false` pour une composition du modèle, qui n'a pas de page : la
   * carte le dit alors sans ambiguïté plutôt que de laisser croire à une
   * recette trouvée quelque part.
   */
  verified: boolean;
  /**
   * Étapes de préparation — jamais garanties fiables pour une recette `web` :
   * le modèle les propose sans avoir lu la page (B6, EF-25). Le tiroir
   * (tâche 6) n'en affiche donc le contenu que pour une composition `ai` ;
   * pour `web`, ce tableau reste vide et l'écran annonce que le détail
   * viendra avec la conservation plutôt que de prétendre qu'il manque.
   */
  steps: string[];
  ingredients: SuggestionIngredientDto[];
  coverage: number;
  group: CoverageGroup;
  missingLabels: string[];
}

/**
 * Ce que l'écran Suggestions reçoit. Plus de `batchId` depuis le lot du
 * 2026-10-15 : l'écran n'est plus servi par une fournée mais par le réservoir
 * (D8), la conservation désigne la recette par son identité de contenu (D9),
 * et plus personne ne lisait cet identifiant — l'écran se contentait de le
 * renvoyer au serveur, qui l'ignorait.
 */
export interface SuggestionBatchDto {
  /** Servi sans aucun appel au modèle — depuis le réservoir permanent (D8, 2026-10-15). */
  fromCache: boolean;
  items: SuggestionDto[];
  /** Message affiché au-dessus du lot (ex. limite du fournisseur atteinte) ; `null` si rien à signaler. */
  notice: string | null;
  /**
   * Recettes connues pour cette orientation, et dans toute l'application
   * (2026-10-19). `items` n'en montre qu'une page : sans ces deux nombres, un
   * réservoir qui ne bouge plus et un réservoir plein se ressemblent — c'est
   * exactement ce qui a donné à Franck l'impression de tourner sur douze
   * recettes.
   */
  poolCount: number;
  poolTotal: number;
}

/* ------------------------------------------------------------------ *
 * Demande parlée (spécification du 2026-10-21)                        *
 * ------------------------------------------------------------------ */

/**
 * Durée maximale d'un enregistrement (D8).
 *
 * Pourquoi soixante secondes : la phrase qui a motivé la fonctionnalité —
 * « il me reste du poulet, et un peu de sauce tomate, je veux faire un plat
 * italien, qu'est-ce que tu me proposes » — se dit en douze secondes. Soixante
 * laissent quatre fois cette marge, donc toute la place aux hésitations et à
 * une liste de restes un peu longue. Au-delà, ce n'est plus une demande mais
 * un bouton qu'on a oublié de relâcher : un enregistrement sans borne est une
 * facture sans borne, et une requête qu'un reverse proxy coupera de toute
 * façon.
 */
export const VOICE_MAX_SECONDS = 60;

/**
 * Taille maximale transmise (D8), et **seule borne que le serveur puisse
 * vérifier** : mesurer une durée exigerait de décoder l'audio, alors que le
 * poids borne la dépense quel que soit le codec. L'écran arrête donc
 * l'enregistrement à `VOICE_MAX_SECONDS`, le serveur refuse au poids, et un
 * client modifié ne peut pas faire payer davantage que ce poids.
 *
 * Pourquoi quatre mébioctets : une minute d'Opus (ce que produit Chrome sur
 * Android, autour de 24 kbit/s) pèse environ 200 Ko, une minute d'AAC (Safari,
 * jusqu'à 256 kbit/s) environ 2 Mo. Quatre laissent passer le pire cas réel
 * avec de la marge, et restent sous la limite de corps de requête par défaut
 * des reverse proxies courants.
 */
export const VOICE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * En dessous, il n'y a pas de parole : un conteneur audio vide pèse déjà
 * quelques centaines d'octets, un kibioctet représente moins d'un tiers de
 * seconde même au débit le plus bas. Payer un appel pour cela est une perte
 * sèche, et l'utilisateur mérite d'apprendre que son micro n'a rien capté
 * (D9) plutôt que d'attendre une réponse vide.
 */
export const VOICE_MIN_BYTES = 1024;

/** Nombre d'ingrédients retenus de la lecture du modèle : au-delà, ce n'est plus une phrase. */
export const VOICE_HEARD_INGREDIENTS_MAX = 20;

/**
 * Types audio acceptés. `audio/webm` (Chrome) et `audio/mp4` (Safari) sont ce
 * que `MediaRecorder` produit réellement sur téléphone ; les autres sont
 * acceptés parce qu'ils ne coûtent rien à laisser passer et que Google les
 * documente. Le type est transmis tel quel au modèle.
 */
export const VOICE_AUDIO_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac'] as const;

/** `audio/webm;codecs=opus` est un `audio/webm` : le paramètre de codec et la casse ne changent pas le type. */
export function isSupportedVoiceMimeType(mimeType: string): boolean {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (VOICE_AUDIO_MIME_TYPES as readonly string[]).includes(base);
}

/**
 * Refus d'un enregistrement, en français, ou `null` s'il est acceptable (D8,
 * D9). Une seule implémentation pour l'écran et pour le serveur : le client
 * n'est jamais une garantie — le serveur refait le contrôle — mais les deux
 * doivent refuser pour la même raison et avec la même phrase.
 */
export function voiceAudioRejection(byteLength: number, mimeType: string): string | null {
  if (!isSupportedVoiceMimeType(mimeType)) return 'Format audio non pris en charge par le modèle.';
  if (byteLength < VOICE_MIN_BYTES) return 'Enregistrement vide : le micro n’a rien capté.';
  if (byteLength > VOICE_MAX_BYTES) {
    return `Enregistrement trop long : ${VOICE_MAX_SECONDS} secondes au maximum. Reformulez votre demande plus brièvement.`;
  }
  return null;
}

/**
 * Ce que le modèle dit avoir entendu (D4) : les ingrédients nommés et
 * l'orientation déduite. Tolérant par construction — une lecture absente ou
 * bancale ne doit jamais faire perdre les recettes du même appel, déjà
 * payées. C'est le service qui tranche qu'une lecture entièrement vide vaut
 * « je n'ai rien compris » (D9).
 */
const voiceHeardSchema = z
  .object({
    ingredients: z.array(z.string()).optional(),
    orientation: z.string().nullish(),
  })
  .optional()
  .transform((heard) => ({
    ingredients: (heard?.ingredients ?? [])
      .map((term) => term.trim())
      .filter((term) => term.length > 0)
      .slice(0, VOICE_HEARD_INGREDIENTS_MAX),
    orientation: heard?.orientation?.trim() ? heard.orientation.trim() : null,
  }));
export type VoiceHeard = z.infer<typeof voiceHeardSchema>;

/**
 * Réponse attendue d'un appel parlé : la lecture **et** les recettes, en un
 * seul appel (D2). Les recettes passent par `modelBatchSchema`, jamais par une
 * seconde règle : même validation recette par recette, même rejet d'un lot
 * dont rien ne tient debout.
 */
export const voiceModelBatchSchema = z
  .object({ heard: voiceHeardSchema, recipes: z.array(z.unknown()) })
  .transform((batch, ctx) => {
    const parsed = modelBatchSchema.safeParse({ recipes: batch.recipes });
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'Aucune recette exploitable dans la réponse du modèle', path: ['recipes'] });
      return z.NEVER;
    }
    return { heard: batch.heard, recipes: parsed.data.recipes };
  });
export type VoiceModelBatch = z.infer<typeof voiceModelBatchSchema>;

/**
 * Ce que l'écran de demande parlée reçoit : une fournée ordinaire, plus la
 * lecture que le modèle a faite de la phrase (D2). Elle est affichée avec les
 * résultats pour qu'un contresens se voie — c'est la contrepartie assumée de
 * l'absence d'étape de confirmation.
 */
export interface VoiceSuggestionBatchDto extends SuggestionBatchDto {
  heard: VoiceHeard;
}
