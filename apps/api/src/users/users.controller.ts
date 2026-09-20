import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createUserSchema, type CreateUserInput } from '@kitchen/shared';
import { AdminOnly, CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { UsersService, type UserDto } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @AdminOnly()
  @Post()
  create(@ZodBody(createUserSchema) body: CreateUserInput): Promise<UserDto> {
    return this.users.create(body);
  }

  /** Révoque toutes les sessions d'un utilisateur (téléphone perdu) : l'admin, ou soi-même. */
  @Delete(':id/sessions')
  @HttpCode(204)
  async revokeSessions(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    if (user.role !== 'ADMIN' && user.id !== id) throw ApiError.forbidden();
    await this.users.revokeSessions(id);
  }
}
