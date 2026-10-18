import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { updateAccountRoleSchema, type AccountDto, type UpdateAccountRoleInput } from '@kitchen/shared';
import { AdminOnly, CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { AccountsService } from './accounts.service.js';

@AdminOnly()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): Promise<AccountDto[]> {
    return this.accounts.list();
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string): Promise<AccountDto> {
    return this.accounts.approve(id);
  }

  /** Partage de l'administration (section 10) : promouvoir ou rétrograder un compte actif. */
  @Post(':id/role')
  @HttpCode(200)
  setRole(
    @Param('id') id: string,
    @ZodBody(updateAccountRoleSchema) body: UpdateAccountRoleInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<AccountDto> {
    return this.accounts.setRole(id, body.role, actor.id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string, @CurrentUser() actor: RequestUser): Promise<AccountDto> {
    return this.accounts.revoke(id, actor.id);
  }
}
