import { z } from 'zod';
import { AI_REQUEST_KINDS, type AiRequestKind, type AiRequestState } from '../rules/ai-requests.js';

/**
 * Abonnement Web Push tel que le navigateur le rend
 * (`PushSubscription.toJSON()`). Les clés sont opaques : on ne vérifie que
 * leur présence et la forme de l'adresse, qui est fournie par le service de
 * push du navigateur et non par l'utilisateur.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;

/**
 * Identifiant d'une demande au modèle, engendré par le téléphone avant
 * l'appel. Il ne peut pas venir du serveur : la page doit pouvoir réclamer son
 * résultat même si elle n'a jamais reçu la réponse.
 *
 * Facultatif partout : une version plus ancienne de l'interface n'en envoie
 * pas, et doit continuer de fonctionner sans rien annoncer.
 */
export const aiRequestIdSchema = z.string().uuid();
export const optionalAiRequestIdSchema = aiRequestIdSchema.optional();

export const aiRequestKindSchema = z.enum(AI_REQUEST_KINDS);

export interface AiRequestStatusDto {
  id: string;
  kind: AiRequestKind;
  state: AiRequestState;
  /** Le résultat de l'usage concerné, tel que l'écran l'attend. `null` tant qu'il n'existe pas. */
  result: unknown;
  error: string | null;
  /** Heure de rejeu d'une demande différée, pour que l'écran puisse le dire. */
  retryAt: string | null;
}

export interface PushPublicKeyDto {
  /** `null` quand aucune clé VAPID n'est configurée : l'interrupteur reste éteint et le dit. */
  publicKey: string | null;
}
