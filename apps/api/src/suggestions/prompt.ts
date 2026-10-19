import { DIFFICULTY_LABELS_FR, DISH_TYPE_LABELS_FR, DISH_TYPES, modelBatchSchema, SUGGESTION_REGION_LABELS_FR, UNITS, type ModelBatch } from '@kitchen/shared';
import type { SuggestionRequest } from './suggestion-provider.js';

/** Système : cadre le rôle, rappelé à chaque appel (nouveau ou reprise). */
export const SUGGESTION_SYSTEM_PROMPT = `Tu proposes des recettes de cuisine à partir d'ingrédients disponibles dans un foyer.
Une partie de tes recettes doit provenir d'une recherche réelle sur le web (utilise l'outil de recherche fourni) : chacune porte alors le lien de la page trouvée. L'autre partie, tu la composes toi-même, sans prétendre qu'elle existe ailleurs.
Chaque étape doit être réalisable sans rien deviner : indique la température du four en degrés Celsius, l'intensité du feu (doux, moyen, vif) et la durée de l'étape chaque fois que la cuisson l'exige. Une étape de cuisson sans température ni durée est inutilisable.
Tu réponds strictement par un objet JSON, sans texte avant ni après, sans clôtures de bloc de code (pas de \`\`\`).`;

/**
 * Variante sans recherche web (réglage `suggestionWebSearch` à faux). Le
 * mensonge à écarter ici est l'inverse du précédent : sans outil de recherche,
 * un modèle invente volontiers une URL plausible pour « faire vrai ». Toutes
 * les recettes doivent donc s'annoncer comme des compositions.
 */
export const SUGGESTION_SYSTEM_PROMPT_NO_SEARCH = `Tu proposes des recettes de cuisine à partir d'ingrédients disponibles dans un foyer.
Tu n'as aucun outil de recherche : tu composes toutes les recettes toi-même, sans prétendre qu'elles existent ailleurs et sans inventer de lien vers un site.
Chaque étape doit être réalisable sans rien deviner : indique la température du four en degrés Celsius, l'intensité du feu (doux, moyen, vif) et la durée de l'étape chaque fois que la cuisson l'exige. Une étape de cuisson sans température ni durée est inutilisable.
Tu réponds strictement par un objet JSON, sans texte avant ni après, sans clôtures de bloc de code (pas de \`\`\`).`;

/**
 * Consigne de diversité (demande de Franck du 2026-10-19 : « diversifie les
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

/** Construit la demande utilisateur ; `retry` ajoute le rappel de format sans changer la commande. */
export function buildSuggestionPrompt(req: SuggestionRequest, options: { retry?: boolean } = {}): string {
  const webSearch = req.webSearch !== false;
  const webCount = Math.max(0, req.count - Math.round(req.count / 3));
  const aiCount = req.count - webCount;
  /**
   * Ingrédients dictés (D1, D4, 2026-10-19). Deux lignes, et pas une : ce qui
   * est imposé et ce qui est seulement disponible ne se lisent pas pareil —
   * le modèle doit pouvoir ignorer une tomate du placard, jamais la merguez
   * qu'on vient de lui nommer. Les termes partent normalisés (minuscules,
   * sans accent) : c'est la forme qui entre aussi dans la signature, et le
   * modèle s'en accommode sans difficulté.
   */
  const dictated = req.ingredients ?? [];
  const stockLine = req.seeds.join(', ') || 'aucun en particulier';
  const lines: string[] =
    dictated.length > 0
      ? [
          `Ingrédients imposés : ${dictated.join(', ')}. Chaque recette proposée doit les utiliser TOUS, sans exception : n'en propose aucune qui en ignore un seul.`,
          `Ingrédients seulement disponibles dans le foyer, à utiliser en complément si cela sert la recette : ${stockLine}.`,
        ]
      : [`Ingrédients disponibles dans le foyer : ${stockLine}.`];
  if (webSearch) {
    lines.push(
      `Propose au total ${req.count} recettes utilisant si possible ces ingrédients : environ ${webCount} trouvées par recherche web réelle (avec leur URL source en https), et environ ${aiCount} composées par toi (sans URL).`,
      'Ajuste ce dosage si la recherche web ne renvoie pas assez de résultats pertinents : complète alors par des compositions.',
      SUGGESTION_DIVERSITY_RULE,
    );
  } else {
    lines.push(
      `Propose au total ${req.count} recettes utilisant si possible ces ingrédients, toutes composées par toi : provenance "ai" et sourceUrl null pour chacune.`,
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
  lines.push(
    'Réponds par un objet JSON unique de la forme { "recipes": [ ... ] }.',
    'Chaque recette porte : title, origin (nom du site ou "Composition" pour une création), region (une valeur parmi : ' +
      Object.keys(SUGGESTION_REGION_LABELS_FR).join(', ') +
      '), totalMinutes (entier), prepMinutes et cookMinutes (entiers en minutes, ou null si la recette n\'a pas cette étape ou que tu ne la distingues pas), difficulty (une valeur parmi VERY_EASY, EASY, INTERMEDIATE, HARD), dishType (une valeur parmi ' +
      DISH_TYPES.join(', ') +
      '), provenance ("web" ou "ai"), sourceUrl (URL https pour "web", null pour "ai"), steps (liste d\'étapes, au moins une pour "ai"), ingredients (liste de { label, quantity, unit }, quantity et unit pouvant être null, unit parmi : ' +
      UNITS.join(', ') +
      ').',
    'Aucun texte, aucune explication, aucune clôture de bloc de code autour de cet objet JSON.',
  );
  if (options.retry) lines.push(SUGGESTION_FORMAT_REMINDER);
  return lines.join('\n');
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
