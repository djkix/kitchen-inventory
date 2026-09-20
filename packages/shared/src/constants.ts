/** Données initiales de la section 22 et constantes transverses. */

export const DEFAULT_EXPIRY_ALERT_DAYS = 7;

export interface DefaultCategory {
  name: string;
  icon: string;
  shelfLifeDays: number | null;
  afterOpeningDays: number | null;
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: 'Fruits frais', icon: '🍎', shelfLifeDays: 7, afterOpeningDays: null },
  { name: 'Légumes frais', icon: '🥬', shelfLifeDays: 10, afterOpeningDays: null },
  { name: 'Viande fraîche', icon: '🥩', shelfLifeDays: 3, afterOpeningDays: 1 },
  { name: 'Poisson frais', icon: '🐟', shelfLifeDays: 2, afterOpeningDays: 1 },
  { name: 'Produits laitiers', icon: '🧀', shelfLifeDays: 14, afterOpeningDays: 4 },
  { name: 'Œufs', icon: '🥚', shelfLifeDays: 28, afterOpeningDays: null },
  { name: 'Surgelés', icon: '🧊', shelfLifeDays: 180, afterOpeningDays: null },
  { name: 'Conserves', icon: '🥫', shelfLifeDays: 1095, afterOpeningDays: 3 },
  { name: 'Épicerie sèche', icon: '🍜', shelfLifeDays: 730, afterOpeningDays: 180 },
  { name: 'Sauces et condiments', icon: '🫙', shelfLifeDays: 730, afterOpeningDays: 60 },
  { name: 'Épices et aromates', icon: '🌶️', shelfLifeDays: 1095, afterOpeningDays: null },
  { name: 'Boissons', icon: '🧃', shelfLifeDays: 365, afterOpeningDays: 5 },
  { name: 'Pain et viennoiserie', icon: '🥖', shelfLifeDays: 3, afterOpeningDays: null },
  { name: 'Restes et préparations maison', icon: '🍲', shelfLifeDays: 3, afterOpeningDays: null },
];

export const DEFAULT_CUISINES: readonly string[] = [
  'Française',
  'Italienne',
  'Japonaise',
  'Coréenne',
  'Chinoise',
  'Thaïlandaise',
  'Vietnamienne',
  'Indienne',
  'Mexicaine',
  'Nord-africaine',
  'Moyen-orientale',
  'Autre',
];

export interface DefaultLocation {
  name: string;
  kind: string;
  temperature: 'ambient' | 'chilled' | 'frozen';
  children?: DefaultLocation[];
}

export const DEFAULT_LOCATIONS: readonly DefaultLocation[] = [
  {
    name: 'Cuisine',
    kind: 'pièce',
    temperature: 'ambient',
    children: [
      { name: 'Placard', kind: 'meuble', temperature: 'ambient' },
      { name: 'Réfrigérateur', kind: 'meuble', temperature: 'chilled' },
      { name: 'Congélateur', kind: 'meuble', temperature: 'frozen' },
    ],
  },
  { name: 'Cellier', kind: 'pièce', temperature: 'ambient' },
];

export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'business_rule',
  'rate_limited',
  'provider_unavailable',
  'not_ready',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const VISION_PROVIDERS = ['none', 'anthropic', 'openai', 'ollama'] as const;
export type VisionProviderName = (typeof VISION_PROVIDERS)[number];

/** Sous ce seuil, la fiche est proposée mais les champs sont marqués « à vérifier » (section 17). */
export const VISION_REVIEW_THRESHOLD = 0.8;
/** Sous ce seuil, aucune fiche n'est proposée : on demande une nouvelle photo. */
export const VISION_REJECT_THRESHOLD = 0.5;
