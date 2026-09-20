/**
 * Types de réponse de l'API qui ne font pas partie du contrat partagé
 * (`@kitchen/shared` ne porte que les schémas d'entrée et les DTO métier).
 */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  createdAt: string;
}

export interface ServiceTokenDto {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type CreatedServiceToken = ServiceTokenDto & { token: string };

export interface MoveContentsResult {
  moved: number;
  targetId: string;
}
