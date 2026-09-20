import { visionSuggestionSchema, type VisionSuggestion } from '@kitchen/shared';
import { ProviderError } from './recognition-provider.js';

export const VISION_SYSTEM_PROMPT = `Tu identifies des produits alimentaires à partir d'une photo prise dans une cuisine ou un placard.
Réponds uniquement par un objet JSON avec exactement ces champs :
- "name" : nom du produit en français, court et précis (ex. « Pâte de piment coréenne (gochujang) »).
- "originalName" : nom tel qu'imprimé sur l'emballage s'il n'est pas en français, avec ses idéogrammes et une translittération entre parenthèses ; sinon null.
- "brand" : marque lisible, sinon null.
- "category" : une valeur parmi : Fruits frais, Légumes frais, Viande fraîche, Poisson frais, Produits laitiers, Œufs, Surgelés, Conserves, Épicerie sèche, Sauces et condiments, Épices et aromates, Boissons, Pain et viennoiserie, Restes et préparations maison ; sinon null.
- "packaging" : type de conditionnement (bouteille, pot, sachet, boîte, paquet, brique, vrac…), sinon null.
- "expiryDate" : date de péremption lisible sur l'emballage au format AAAA-MM-JJ, sinon null. Si seul le mois est lisible, prends le dernier jour du mois.
- "confidence" : ta confiance globale entre 0 et 1. Sous 0,5, la photo est inexploitable : ne devine pas, mets un nom générique et une confiance basse.
N'invente jamais une marque ni une date. Les étiquettes japonaises, coréennes, chinoises et thaïes sont fréquentes : lis-les et traduis le nom.`;

/** Schéma JSON strict transmis aux fournisseurs qui savent contraindre leur sortie. */
export const VISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'originalName', 'brand', 'category', 'packaging', 'expiryDate', 'confidence'],
  properties: {
    name: { type: 'string' },
    originalName: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    packaging: { type: ['string', 'null'] },
    expiryDate: { type: ['string', 'null'], description: 'AAAA-MM-JJ' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export function userPrompt(hint?: string): string {
  return hint ? `Identifie ce produit. Indice donné par l'utilisateur : « ${hint} ».` : 'Identifie ce produit.';
}

/** Extrait et valide le JSON strict ; toute réponse non conforme est un échec, jamais une fiche inventée. */
export function parseSuggestion(text: string): VisionSuggestion {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new ProviderError('Le fournisseur de vision n’a pas renvoyé de JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ProviderError('JSON du fournisseur de vision illisible', error);
  }
  const result = visionSuggestionSchema.safeParse(parsed);
  if (!result.success) throw new ProviderError('Réponse du fournisseur de vision non conforme au schéma', result.error.issues);
  return result.data;
}
