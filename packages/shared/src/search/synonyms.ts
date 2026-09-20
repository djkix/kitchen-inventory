import { normalizeProductName } from '../rules/duplicates.js';

/**
 * Synonymes de recherche (EF-11) : « nouilles » trouve « ramen ». Table
 * statique au lot 1, appliquée à la requête avant l'appel SQL.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['nouilles', 'nouille', 'ramen', 'udon', 'soba', 'vermicelles', 'pates', 'spaghetti', 'noodles'],
  ['riz', 'rice', 'basmati', 'thai', 'jasmin', 'sushi'],
  ['sauce soja', 'soja', 'shoyu', 'soy sauce', 'soy'],
  ['piment', 'gochujang', 'sambal', 'sriracha', 'harissa', 'chili'],
  ['lait', 'milk', 'lait de coco', 'coco'],
  ['tomate', 'tomates', 'pelees', 'concentre', 'passata'],
  ['haricots', 'haricot', 'beans', 'lentilles', 'pois chiches', 'legumineuses'],
  ['fromage', 'cheese', 'emmental', 'comte', 'parmesan', 'mozzarella'],
  ['yaourt', 'yogourt', 'yogurt', 'skyr'],
  ['huile', 'oil', 'olive', 'sesame'],
  ['farine', 'flour', 'semoule'],
  ['sucre', 'sugar', 'miel', 'sirop'],
  ['the', 'tea', 'matcha', 'infusion'],
  ['cafe', 'coffee', 'expresso'],
  ['poulet', 'chicken', 'volaille'],
  ['boeuf', 'beef', 'veau'],
  ['porc', 'pork', 'lardons', 'jambon'],
  ['poisson', 'fish', 'thon', 'saumon', 'sardines', 'maquereau'],
  ['algues', 'nori', 'wakame', 'kombu'],
  ['tofu', 'soja ferme', 'tempeh'],
  ['bouillon', 'dashi', 'fond', 'cube'],
  ['curry', 'cari', 'garam masala', 'pate de curry'],
];

const INDEX = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    const key = normalizeProductName(term);
    const set = INDEX.get(key) ?? new Set<string>();
    for (const other of group) set.add(normalizeProductName(other));
    INDEX.set(key, set);
  }
}

/** Renvoie la requête normalisée suivie de ses synonymes, sans doublon. */
export function expandSearchTerms(query: string): string[] {
  const normalized = normalizeProductName(query);
  if (normalized.length === 0) return [];
  const terms = new Set<string>([normalized]);
  for (const synonym of INDEX.get(normalized) ?? []) terms.add(synonym);
  // Requête de plusieurs mots : chaque mot peut porter un synonyme.
  for (const word of normalized.split(' ')) {
    for (const synonym of INDEX.get(word) ?? []) terms.add(synonym);
  }
  return [...terms];
}
