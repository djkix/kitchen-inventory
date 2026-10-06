import type { VisionSuggestion } from '@kitchen/shared';

export interface RecognitionInput {
  image: Buffer;
  mimeType: string;
  hint?: string;
  /**
   * Modèle choisi pour CET appel, résolu par l'appelant depuis les réglages
   * (base, sinon environnement). Absent, le fournisseur applique le modèle
   * reçu à sa construction puis son propre défaut. Le modèle ne peut pas être
   * figé à la construction : les fournisseurs sont des singletons Nest, et un
   * réglage changé à l'écran n'aurait alors d'effet qu'au redémarrage.
   */
  model?: string;
}

export interface RecognitionOutput {
  suggestion: VisionSuggestion;
  /** Réponse brute du fournisseur, conservée dans RecognitionLog pour rejouer les échecs. */
  raw: unknown;
  costCents: number | null;
}

/**
 * Section 5, niveau 4 : le fournisseur de vision est derrière une interface
 * pour pouvoir passer d'une API cloud à un modèle local sans toucher au reste.
 */
export interface RecognitionProvider {
  readonly name: string;
  readonly enabled: boolean;
  recognize(input: RecognitionInput): Promise<RecognitionOutput>;
}

export const RECOGNITION_PROVIDER = Symbol('RECOGNITION_PROVIDER');

/** Échec côté fournisseur (réseau, quota, réponse non conforme) : devient `502 provider_unavailable`. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
