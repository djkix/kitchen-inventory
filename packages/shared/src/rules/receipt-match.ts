import { isCountableUnit, type Unit } from '../units.js';
import { significantWords } from './suggestion-ingredients.js';

/**
 * Rapprochement d'une ligne de ticket de caisse au catalogue (EF-29). Le modèle
 * lit le ticket ; il ne choisit jamais le produit : c'est cette règle qui tranche.
 */

/** Miroir de l'énumération Prisma `ReceiptLineState`. */
export type ReceiptLineState = 'MATCHED' | 'AMBIGUOUS' | 'UNKNOWN';

export type ReceiptCandidate = { id: string; name: string; defaultUnit: Unit };

export type ReceiptMatch = { state: ReceiptLineState; productId: string | null; candidateIds: string[] };

/** Contenance collée à son nombre : « 1KG », « 75CL », « 1,5 L ». */
const CONTENT_SIZE = /\b\d+(?:[.,]\d+)?\s?(?:kg|g|mg|l|dl|cl|ml)\b/gi;
/** Multiplicateur de tête : « 3 X », « 3x ». */
const LEADING_MULTIPLIER = /^\s*\d+\s*[x×]\s*/i;

/**
 * Mots d'un libellé. Toute ponctuation sépare : « YAOURT NAT.X4 » et « YAOURT
 * NAT. X4 » doivent donner la même clé, sinon le même produit figure deux fois
 * dans les libellés à rattacher. « d’olive » donne « olive » par la même règle.
 * Les nombres isolés tombent : « 30 » ou « 1/2 » gonflaient le compte de mots
 * au point qu'aucun nom de produit ne pouvait plus couvrir le libellé.
 */
const words = (text: string): string[] =>
  significantWords(text.replace(/[^\p{L}\p{N}]+/gu, ' ')).filter((word) => !/^\p{N}+$/u.test(word));

/** Libellé de ticket débarrassé des contenances et du multiplicateur, en forme comparable. */
export function normalizeReceiptLabel(raw: string): string {
  return words(raw.replace(LEADING_MULTIPLIER, '').replace(CONTENT_SIZE, ' ')).join(' ');
}

/**
 * Le nom d'un produit couvre-t-il **tous** les mots significatifs du libellé ?
 * Une seule définition : `matchReceiptLine` s'en sert pour trancher, l'écran
 * pour mettre en tête le candidat qui couvre le libellé (D6).
 */
export function coversReceiptLabel(label: string, name: string): boolean {
  const labelWords = normalizeReceiptLabel(label).split(' ').filter(Boolean);
  const names = new Set(words(name));
  return labelWords.length > 0 && labelWords.every((word) => names.has(word));
}

/**
 * Un alias connu l'emporte : aucune recherche. Sinon MATCHED exige un unique
 * candidat qui couvre **tous** les mots significatifs du libellé ; le
 * recouvrement partiel (au moins un mot et la moitié du libellé, car les
 * tickets abrègent : « H OLIVE » pour « Huile d'olive ») ne sert qu'à dresser
 * la liste AMBIGUOUS.
 * MATCHED suppose aussi une unité qui compte des objets entiers
 * (`COUNTABLE_UNITS`), alias compris : le « 3 × » du ticket compte des
 * paquets, l'ajouter à un produit suivi en grammes écrirait trois grammes
 * dans le stock.
 */
export function matchReceiptLine(
  label: string,
  alias: ReceiptCandidate | null,
  candidates: readonly ReceiptCandidate[],
): ReceiptMatch {
  if (alias) {
    return isCountableUnit(alias.defaultUnit)
      ? { state: 'MATCHED', productId: alias.id, candidateIds: [] }
      : { state: 'AMBIGUOUS', productId: null, candidateIds: [alias.id] };
  }
  const labelWords = normalizeReceiptLabel(label).split(' ').filter(Boolean);
  if (labelWords.length === 0) return { state: 'UNKNOWN', productId: null, candidateIds: [] };
  const scored = candidates
    .map((c) => {
      const names = new Set(words(c.name));
      return { c, shared: labelWords.filter((w) => names.has(w)).length };
    })
    .filter(({ shared }) => shared > 0 && shared * 2 >= labelWords.length);
  const candidateIds = scored.map(({ c }) => c.id);
  const full = scored.filter(({ c }) => coversReceiptLabel(label, c.name));
  const only = full.length === 1 ? full[0]?.c : undefined;
  if (only && isCountableUnit(only.defaultUnit)) return { state: 'MATCHED', productId: only.id, candidateIds };
  return { state: candidateIds.length === 0 ? 'UNKNOWN' : 'AMBIGUOUS', productId: null, candidateIds };
}
