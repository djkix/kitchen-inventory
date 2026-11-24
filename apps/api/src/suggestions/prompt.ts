import {
  DIFFICULTY_LABELS_FR,
  DISH_TYPE_LABELS_FR,
  DISH_TYPES,
  modelBatchSchema,
  singleRecipeModelSchema,
  SUGGESTION_REGION_LABELS_FR,
  UNITS,
  type ModelBatch,
  type SingleRecipeModelAnswer,
} from '@kitchen/shared';
import type { SuggestionRequest, VoiceSuggestionRequest } from './suggestion-provider.js';

/**
 * Mesures de cuisine (demande du propriétaire, 2026-11-21 : « je dois toujours
 * avoir les informations en ml, g »). Le jeu d'unités de la section 15 ne
 * contient ni cuillère ni pincée — le modèle, lui, raisonne en cuillères, et
 * n'avait donc d'autre issue que de laisser la quantité vide ou de la glisser
 * dans le libellé. Résultat : « Huile d'olive » sans un chiffre, et une fiche
 * dont le champ « Parts » ne pouvait rien mettre à l'échelle, puisqu'une
 * quantité absente ne se multiplie pas.
 *
 * La conversion revient donc au modèle, avec ses équivalences écrites noir sur
 * blanc : c'est le seul endroit de la chaîne qui sache qu'une cuillère à soupe
 * d'huile fait 15 ml. Partagée par les trois consignes (écrite, parlée) et par
 * la réécriture d'une page web, sans quoi une recette conservée repartirait en
 * cuillères.
 */
export const MEASUREMENT_RULE = `Toute quantité est chiffrée dans une unité que l'application connaît : gramme, kilo, millilitre, litre, pièce, paquet, boîte ou sachet. Choisis celle qui se lit le mieux en cuisine — 1 kg de pommes de terre plutôt que 1000 g, 20 g de beurre plutôt que 0,02 kg. Jamais de cuillère, de pincée, de verre, de tasse, de bol, de filet ni de « quelques » — convertis-les toi-même (une cuillère à soupe = 15 ml ou 15 g, une cuillère à café = 5 ml ou 5 g, une pincée = 1 g, un verre = 200 ml, une tasse = 250 ml). Le libellé d'un ingrédient ne porte jamais de quantité, et les étapes emploient les mêmes unités que la liste d'ingrédients. Ne laisse « quantity » et « unit » vides que pour ce qui se dose vraiment au goût, comme le sel et le poivre.`;

/**
 * Exigences de métier, partagées par les deux consignes système et donc par
 * les trois chemins (écrit, parlé, relance). Écrites le 2026-11-20 après le
 * constat du propriétaire : le réservoir de production tenait 399 recettes à
 * 3,5 ingrédients et 4,3 étapes de moyenne — « Wraps croustillants au
 * concentré de tomate et abricots », trois ingrédients — là où les mêmes
 * demandes posées à la main rendaient des plats structurés.
 *
 * Trois manques expliquaient l'écart, et chacun a sa ligne ici :
 *
 * 1. **Le placard n'existait pas.** La consigne ne nommait que les huit
 *    graines tirées du stock, et le modèle s'y tenait à la lettre : pas d'ail,
 *    pas d'échalote, pas de beurre, parce que personne ne les avait
 *    scannés. Un foyer n'inventorie pas son sel.
 * 2. **Rien ne disait à quoi ressemble une recette finie.** Trois ingrédients
 *    et trois étapes satisfaisaient la demande aussi bien que douze.
 * 3. **La liste du stock se lisait comme une liste de courses à épuiser.**
 *    D'où les mariages absurdes : tout ce qui était nommé devait servir.
 *
 * La ligne sur les cuissons est l'ancienne, inchangée.
 */
const QUALITY_RULES = `Tu écris pour quelqu'un qui va vraiment cuisiner ce soir : chaque recette est un plat abouti de cuisine familiale, jamais un assemblage de ce qui traîne dans le placard.
Tu peux supposer présents dans tout foyer, sans que personne ait eu à te les nommer : sel, poivre, sucre, huile, beurre, vinaigre, farine, oignon, ail, échalote, moutarde, bouillon, crème, lait, œufs, herbes et épices courantes. Emploie-les librement et fais-les figurer dans la liste d'ingrédients de la recette dès qu'elle les utilise.
Construis un vrai plat : une base aromatique revenue, un assaisonnement nommé, une liaison, une réduction ou un gratinage quand le plat s'y prête. Une recette porte au moins six ingrédients et au moins cinq étapes.
Les ingrédients du foyer sont une réserve où puiser, pas une liste à épuiser : laisse de côté ceux qui n'ont rien à faire dans le plat plutôt que de les y forcer. Une recette qui en emploie trois et qu'on a envie de manger vaut mieux qu'une qui les case tous.
Sauf demande contraire, les quantités sont données pour quatre personnes.
${MEASUREMENT_RULE}
Chaque étape doit être réalisable sans rien deviner : indique la température du four en degrés Celsius, l'intensité du feu (doux, moyen, vif) et la durée de l'étape chaque fois que la cuisson l'exige. Une étape de cuisson sans température ni durée est inutilisable.`;

/** Système : cadre le rôle, rappelé à chaque appel (nouveau ou reprise). */
export const SUGGESTION_SYSTEM_PROMPT = `Tu proposes des recettes de cuisine à partir d'ingrédients disponibles dans un foyer.
Une partie de tes recettes doit provenir d'une recherche réelle sur le web (utilise l'outil de recherche fourni) : chacune porte alors le lien de la page trouvée. L'autre partie, tu la composes toi-même, sans prétendre qu'elle existe ailleurs.
${QUALITY_RULES}
Tu réponds strictement par un objet JSON, sans texte avant ni après, sans clôtures de bloc de code (pas de \`\`\`).`;

/**
 * Variante sans recherche web (réglage `suggestionWebSearch` à faux). Le
 * mensonge à écarter ici est l'inverse du précédent : sans outil de recherche,
 * un modèle invente volontiers une URL plausible pour « faire vrai ». Toutes
 * les recettes doivent donc s'annoncer comme des compositions.
 */
export const SUGGESTION_SYSTEM_PROMPT_NO_SEARCH = `Tu proposes des recettes de cuisine à partir d'ingrédients disponibles dans un foyer.
Tu n'as aucun outil de recherche : tu composes toutes les recettes toi-même, sans prétendre qu'elles existent ailleurs et sans inventer de lien vers un site.
${QUALITY_RULES}
Tu réponds strictement par un objet JSON, sans texte avant ni après, sans clôtures de bloc de code (pas de \`\`\`).`;

/**
 * Consigne de diversité (demande du propriétaire du 2026-10-19 : « diversifie les
 * propositions (pas de variante) »). Elle remplace l'ancien « Aucune variété de
 * régions ou de styles n'est exigée », qui disait exactement l'inverse et
 * laissait le modèle tourner autour d'un même plat — douze recettes toutes
 * bâties sur les fusilli et les abricots.
 *
 * Elle ne dispense d'aucune orientation : les lignes de région, de durée, de
 * difficulté et de type de plat sont ajoutées après et restent impératives.
 * Diversifier, c'est varier à l'intérieur du filtre demandé.
 */
const SUGGESTION_DIVERSITY_RULE =
  "Les recettes proposées doivent être nettement différentes les unes des autres : jamais deux variantes d'une même recette, et pas deux fois le même plat sous un autre nom. Varie l'ingrédient principal, la technique de cuisson et la base (pâtes, riz, légumes, légumineuses, pain, œufs, viande, poisson).";

/**
 * Nombre maximal de titres déjà connus cités au modèle. Borne volontaire : la
 * liste part à CHAQUE appel, un prompt qui enfle finit par coûter plus de
 * jetons que les recettes en double qu'il économise, et une consigne noyée au
 * milieu de centaines de titres cesse d'être lue.
 *
 * Au-delà de la borne, les titres les plus anciens ne sont plus cités : le
 * modèle peut les reproposer. Ce n'est pas une perte — `suggestionIdentity`
 * les reconnaît au dédoublonnage du réservoir, ils ne créent pas de ligne. Le
 * coût se limite à une place perdue dans la fournée payée.
 */
export const KNOWN_TITLES_CAP = 40;

/** Rappel ajouté à la reprise après une réponse illisible ou non conforme : même demande, format répété. */
export const SUGGESTION_FORMAT_REMINDER =
  "Ta réponse précédente n'était pas exploitable : ce n'était pas un objet JSON unique et conforme. Réponds cette fois uniquement par l'objet JSON demandé ci-dessus, rien d'autre autour, sans clôtures de bloc de code.";

/**
 * Ce que le foyer possède (2026-11-24), annoncé au modèle. La ligne sur les
 * quantités n'est pas une précaution de style : la liste n'en porte aucune, et
 * sans cet avertissement le modèle annoncerait des manques qu'il ne peut pas
 * constater.
 */
function householdLines(household: string): string[] {
  return [
    `Produits présents dans le foyer, un par ligne avec leur emplacement :\n${household}`,
    "Cette liste ne dit ni les quantités disponibles ni les dates : ne prétends donc jamais qu'il en manque, et ne parle d'aucune péremption.",
  ];
}

/** Construit la demande utilisateur ; `retry` ajoute le rappel de format sans changer la commande. */
export function buildSuggestionPrompt(req: SuggestionRequest, options: { retry?: boolean } = {}): string {
  const webSearch = req.webSearch !== false;
  const webCount = Math.max(0, req.count - Math.round(req.count / 3));
  const aiCount = req.count - webCount;
  /**
   * Ingrédients dictés (D1, D4, 2026-10-19). Deux lignes, et pas une : ce qui
   * est imposé et ce qui est seulement disponible ne se lisent pas pareil —
   * le modèle doit pouvoir ignorer une tomate du placard, jamais la merguez
   * qu'on vient de lui nommer. La saisie part **telle qu'elle a été tapée**
   * (tour de correction 1) : « crème fraîche » doit arriver accentué au
   * modèle, la forme normalisée ne sert qu'à la signature (D3) et au
   * rapprochement au réservoir (D8).
   */
  const dictated = req.ingredients?.terms ?? [];
  const lines: string[] =
    dictated.length > 0
      ? [
          `Ingrédients imposés : ${req.ingredients?.raw ?? ''}. Chaque recette proposée doit les utiliser TOUS, sans exception : n'en propose aucune qui en ignore un seul.`,
          ...householdLines(req.household),
        ]
      : householdLines(req.household);
  /**
   * Un seul référent par phrase (tour de correction 1). « Utilisant si
   * possible ces ingrédients » voisinait avec « doit les utiliser TOUS » :
   * deux consignes contradictoires, sur un « ces ingrédients » devenu
   * ambigu — et des fournées payées qui ignoraient la merguez.
   */
  const useClause =
    dictated.length > 0 ? 'utilisant tous les ingrédients imposés ci-dessus' : 'utilisant si possible ces ingrédients';
  if (webSearch) {
    lines.push(
      `Propose au total ${req.count} recettes ${useClause} : environ ${webCount} trouvées par recherche web réelle (avec leur URL source en https), et environ ${aiCount} composées par toi (sans URL).`,
      'Ajuste ce dosage si la recherche web ne renvoie pas assez de résultats pertinents : complète alors par des compositions.',
      SUGGESTION_DIVERSITY_RULE,
    );
  } else {
    lines.push(
      `Propose au total ${req.count} recettes ${useClause}, toutes composées par toi : provenance "ai" et sourceUrl null pour chacune.`,
      SUGGESTION_DIVERSITY_RULE,
    );
  }
  if (req.region) lines.push(`Oriente ${webSearch ? 'la recherche' : 'tes propositions'} vers la cuisine ${SUGGESTION_REGION_LABELS_FR[req.region]}.`);
  if (req.maxMinutes) lines.push(`Chaque recette doit se faire en ${req.maxMinutes} minutes maximum au total.`);
  if (req.difficulty) lines.push(`Niveau de difficulté visé : ${DIFFICULTY_LABELS_FR[req.difficulty]}.`);
  if (req.dishType) lines.push(`Ne propose que des recettes de type « ${DISH_TYPE_LABELS_FR[req.dishType]} ».`);
  // Sans cette ligne, rien n'empêchait le modèle de reproposer ce que le
  // réservoir contient déjà : la consigne de diversité ne vaut qu'à
  // l'intérieur d'une fournée, elle ignore les précédentes.
  const knownTitles = req.knownTitles?.slice(0, KNOWN_TITLES_CAP) ?? [];
  if (knownTitles.length > 0) {
    lines.push(`Ne propose aucune de ces recettes, déjà connues de l'application, ni une simple variante de l'une d'elles : ${knownTitles.map((title) => `« ${title} »`).join(', ')}.`);
  }
  lines.push('Réponds par un objet JSON unique de la forme { "recipes": [ ... ] }.', recipeFieldsLine(), FORMAT_TAIL);
  if (options.retry) lines.push(SUGGESTION_FORMAT_REMINDER);
  return lines.join('\n');
}

/**
 * Description des champs d'une recette, partagée par la demande écrite et la
 * demande parlée (2026-10-21) : un seul endroit à tenir à jour, sans quoi les
 * deux chemins divergeraient dès le premier champ ajouté au schéma.
 */
function recipeFieldsLine(): string {
  return (
    'Chaque recette porte : title, origin (nom du site ou "Composition" pour une création), region (une valeur parmi : ' +
    Object.keys(SUGGESTION_REGION_LABELS_FR).join(', ') +
    "), totalMinutes (entier), prepMinutes et cookMinutes (entiers en minutes, ou null si la recette n'a pas cette étape ou que tu ne la distingues pas), difficulty (une valeur parmi VERY_EASY, EASY, INTERMEDIATE, HARD), dishType (une valeur parmi " +
    DISH_TYPES.join(', ') +
    '), provenance ("web" ou "ai"), sourceUrl (URL https pour "web", null pour "ai"), steps (liste d\'étapes, au moins cinq pour "ai"), ingredients (liste de { label, quantity, unit }, quantity et unit pouvant être null pour ce qui se dose au goût seulement, unit parmi : ' +
    UNITS.join(', ') +
    '), notes (quelques phrases en français sur CETTE recette face au stock du foyer : les substitutions que tu as faites et pourquoi, où un ingrédient est rangé si cela surprend, une variante si elle vaut la peine — jamais de date de péremption, jamais de quantité en stock, et null si tu n’as rien d’utile à dire).'
  );
}

const FORMAT_TAIL = 'Aucun texte, aucune explication, aucune clôture de bloc de code autour de cet objet JSON.';

/**
 * Demande « une recette » (spécification du 2026-11-24) : une phrase, une
 * recette, et les remarques qui vont avec.
 *
 * Trois écarts volontaires avec la consigne de fournée :
 *
 * 1. **Aucune recherche web.** Une recette `web` dont la page est illisible est
 *    jetée à l'ingestion, et la recherche est éteinte en production : sur une
 *    seule recette, l'appel payé ne laisserait rien à l'écran.
 * 2. **Pas de consigne de diversité, pas de titres déjà connus.** Il n'y a
 *    qu'une recette à proposer, et elle doit répondre à la demande, pas éviter
 *    le réservoir.
 * 3. **`heard` est demandé même par écrit.** La phrase est à l'écran, donc
 *    inutile à relire ; mais sans les ingrédients relevés, un ingrédient nommé
 *    dans la demande et absent du stock s'afficherait « Manquant » — le défaut
 *    que D5 du 2026-10-19 avait corrigé pour la voix.
 */
export function buildSingleRecipePrompt(req: { text: string; household: string }, options: { retry?: boolean } = {}): string {
  const lines: string[] = [
    `Demande de la personne, telle qu'elle l'a écrite : « ${req.text} »`,
    ...householdLines(req.household),
    'Propose UNE SEULE recette qui réponde à cette demande, composée par toi : provenance "ai" et sourceUrl null.',
    "Si la demande ne porte sur aucune recette, ou que tu ne peux pas y répondre, rends \"recipe\": null plutôt qu'une recette de remplissage.",
    'Réponds par un objet JSON unique de la forme { "heard": { "ingredients": [ ... ], "orientation": "…" ou null }, "recipe": { ... } }.',
    "« heard.ingredients » ne contient que les ingrédients nommés dans la demande, jamais les produits du foyer ci-dessus.",
    recipeFieldsLine(),
    FORMAT_TAIL,
  ];
  if (options.retry) lines.push(SUGGESTION_FORMAT_REMINDER);
  return lines.join('\n');
}

/**
 * Demande parlée (spécification du 2026-10-21, D2 et D4) : un seul appel, qui
 * porte l'enregistrement, et qui rend à la fois ce que le modèle a entendu et
 * les recettes. Il n'y a pas d'étape de confirmation — c'est le choix du
 * propriétaire — donc la lecture revient avec les résultats pour qu'un contresens
 * se voie.
 *
 * Le stock réel part dans le même prompt : croiser la parole avec ce que le
 * placard contient est précisément ce que l'application Gemini ne sait pas
 * faire, et toute la valeur de la fonctionnalité.
 */
export function buildVoicePrompt(req: VoiceSuggestionRequest): string {
  const lines: string[] = [
    "L'enregistrement audio joint est une demande parlée : une personne dit ce qu'elle a sous la main et le genre de plat qu'elle veut.",
    'Écoute-le, puis relève les ingrédients qu’elle nomme et l’orientation qu’elle demande (type de plat, cuisine, durée, envie — une phrase courte en français, ou null si elle n’en exprime aucune).',
    ...householdLines(req.household),
    'Propose UNE SEULE recette qui réponde à ce qu’elle a dit, composée par toi : provenance "ai" et sourceUrl null.',
    "Si tu ne tires rien de l'enregistrement, rends \"recipe\": null plutôt qu'une recette de remplissage.",
    'Réponds par un objet JSON unique de la forme { "heard": { "ingredients": [ ... ], "orientation": "…" ou null }, "recipe": { ... } }.',
    "« heard.ingredients » ne contient que ce que tu as réellement entendu nommer, jamais les produits du foyer ci-dessus.",
    recipeFieldsLine(),
    FORMAT_TAIL,
  ];
  return lines.join('\n');
}

/**
 * Recette unique rendue à une demande en langage naturel (2026-11-24). Même
 * intransigeance que `parseVoiceBatch` sur le format ; la seule souplesse est
 * `recipe: null`, qui dit « je n'ai rien tiré de cette demande » et que le
 * service traduit en refus français.
 */
export function parseSingleRecipe(text: string): SingleRecipeModelAnswer {
  const stripped = stripJsonFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new InvalidBatchJsonError('JSON du fournisseur de suggestions illisible');
  }
  const result = singleRecipeModelSchema.safeParse(parsed);
  if (!result.success) throw new InvalidBatchJsonError('Réponse du fournisseur de suggestions non conforme au schéma d’une recette unique');
  return result.data;
}

/**
 * Lecture et recette d'une demande parlée. Depuis le 2026-11-24, un appel
 * parlé rend UNE recette, comme la demande écrite : même schéma, même
 * souplesse sur `recipe: null`.
 */
export function parseVoiceAnswer(text: string): SingleRecipeModelAnswer {
  return parseSingleRecipe(text);
}

/**
 * Retire d'éventuelles clôtures ``` (ou ```json) autour de la réponse (vigilance 1),
 * et à défaut se rabat sur la première accolade ouvrante et la dernière fermante :
 * le modèle ajoute parfois une phrase avant ou après l'objet JSON malgré la consigne.
 * Une réponse sans aucune accolade reste telle quelle et échouera au parsing, ce qui
 * est le comportement voulu — on ne devine pas un objet qui n'est pas là.
 */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/** Échec de lecture du lot : JSON illisible ou non conforme. Distinct de `ProviderError` pour piloter la reprise unique. */
export class InvalidBatchJsonError extends Error {}

/** Extrait et valide le lot de recettes. Toute réponse non conforme est un échec, jamais un lot inventé. */
export function parseModelBatch(text: string): ModelBatch {
  const stripped = stripJsonFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new InvalidBatchJsonError('JSON du fournisseur de suggestions illisible');
  }
  const result = modelBatchSchema.safeParse(parsed);
  if (!result.success) throw new InvalidBatchJsonError('Réponse du fournisseur de suggestions non conforme au schéma');
  return result.data;
}
