import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email({ message: 'Adresse e-mail invalide' }).max(254);
const passwordSchema = z.string().min(12, { message: 'Le mot de passe doit faire au moins 12 caractères' }).max(256);

/**
 * @deprecated Les mots de passe ne sont plus un moyen de connexion (D5). Les
 * routes correspondantes ont disparu de l'API avec la tâche 3 ; ces schémas ne
 * servent plus qu'aux écrans que la tâche 5 remplace, et partent avec eux.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Mot de passe requis' }).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * @deprecated Les mots de passe ne sont plus un moyen de connexion (D5). Les
 * routes correspondantes ont disparu de l'API avec la tâche 3 ; ces schémas ne
 * servent plus qu'aux écrans que la tâche 5 remplace, et partent avec eux.
 */
export const setupSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(80),
  password: passwordSchema,
});
export type SetupInput = z.infer<typeof setupSchema>;

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

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(80),
  role: userRoleSchema.default('MEMBER'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * @deprecated Les mots de passe ne sont plus un moyen de connexion (D5). Les
 * routes correspondantes ont disparu de l'API avec la tâche 3 ; ces schémas ne
 * servent plus qu'aux écrans que la tâche 5 remplace, et partent avec eux.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

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
  credential: z.string().trim().min(1, { message: 'Jeton Google requis' }),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

/** Une ligne de Réglages › Comptes. */
export interface AccountDto {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  status: AccountStatus;
  createdAt: string;
}
