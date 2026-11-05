import { optionalAiRequestIdSchema } from '@kitchen/shared';

/**
 * `requestId` d'un envoi multipart (conception du 2026-11-02).
 *
 * Facultatif, et silencieusement ignoré s'il est mal formé : une interface
 * plus ancienne n'en envoie pas, et ce champ annexe ne doit jamais faire
 * échouer une demande par ailleurs valable.
 */
export function aiRequestField(rawBody: unknown): string | undefined {
  const raw = (rawBody as { requestId?: unknown } | null)?.requestId;
  return optionalAiRequestIdSchema.safeParse(typeof raw === 'string' ? raw : undefined).data ?? undefined;
}
