import type { RecognitionOutput, RecognitionProvider } from './recognition-provider.js';

/** Section 22 : fournisseur de vision désactivé jusqu'à saisie d'une clé. */
export class NoneProvider implements RecognitionProvider {
  readonly name = 'none';
  readonly enabled = false;

  recognize(): Promise<RecognitionOutput> {
    return Promise.reject(new Error('Fournisseur de vision désactivé'));
  }
}
