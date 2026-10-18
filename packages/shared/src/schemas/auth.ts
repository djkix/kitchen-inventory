import { z } from 'zod';

export const authStatusSchema = z.object({ setupRequired: z.boolean() });
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const userRoleSchema = z.enum(['ADMIN', 'MEMBER']);

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const createServiceTokenSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(80),
});
export type CreateServiceTokenInput = z.infer<typeof createServiceTokenSchema>;

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS_FR: Record<AccountStatus, string> = {
  PENDING: 'En attente',
  ACTIVE: 'Actif',
  REVOKED: 'Refusé',
};

/** Corps de `POST /auth/google`. Le nom `credential` est imposé par le callback GSI. */
export const googleLoginSchema = z.object({
  // Borné comme toutes les entrées du projet : un jeton Google fait 1 à 2 ko.
  credential: z.string().trim().min(1, { message: 'Jeton Google requis' }).max(4096, { message: 'Jeton Google invalide' }),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

/**
 * Corps de `POST /auth/recovery` : la porte de secours (D6). Aucun écran ne
 * l'utilise — la route existe, elle n'est pas affichée — mais le schéma vit
 * ici comme tous les autres, défini une seule fois.
 */
export const recoveryLoginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, { message: 'Adresse requise' }).max(320),
  password: z.string().min(1, { message: 'Mot de passe requis' }).max(256),
});
export type RecoveryLoginInput = z.infer<typeof recoveryLoginSchema>;

/** Une ligne de Réglages › Comptes. */
export interface AccountDto {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  status: AccountStatus;
  createdAt: string;
}
