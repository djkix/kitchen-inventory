import { Controller, Delete, HttpCode, Param } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { UsersService } from './users.service.js';

/**
 * Ce qui reste du domaine « utilisateurs » : la révocation des sessions.
 *
 * Un compte ne se crée pas ici — la personne demande l'accès en se connectant
 * avec Google et un administrateur valide depuis `/accounts` (D10 : une adresse
 * tapée à la main ouvrait l'inventaire au titulaire réel d'une adresse mal
 * orthographiée, sans rien faire apparaître dans la file d'attente). Et il ne
 * se liste plus ici : `GET /accounts` rend la même chose avec les états, et
 * deux listes des mêmes personnes dont une ignore les demandes en attente
 * était une confusion garantie (revue de la tâche 6).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Révoque toutes les sessions d'un utilisateur (téléphone perdu) : l'admin, ou soi-même. */
  @Delete(':id/sessions')
  @HttpCode(204)
  async revokeSessions(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    if (user.role !== 'ADMIN' && user.id !== id) throw ApiError.forbidden();
    await this.users.revokeSessions(id);
  }
}
