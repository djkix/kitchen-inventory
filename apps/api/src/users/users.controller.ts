import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { UsersService, type UserDto } from './users.service.js';

/**
 * Lecture du foyer, pour les écrans qui ont besoin de savoir qui en fait
 * partie. **Un compte ne se crée pas ici** : la personne demande l'accès en se
 * connectant avec Google et un administrateur valide depuis `/accounts`. Une
 * adresse tapée à la main ouvrait l'inventaire au titulaire réel d'une adresse
 * mal orthographiée, sans que rien n'apparaisse dans la file d'attente (revue
 * de la tâche 3).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  /** Révoque toutes les sessions d'un utilisateur (téléphone perdu) : l'admin, ou soi-même. */
  @Delete(':id/sessions')
  @HttpCode(204)
  async revokeSessions(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    if (user.role !== 'ADMIN' && user.id !== id) throw ApiError.forbidden();
    await this.users.revokeSessions(id);
  }
}
