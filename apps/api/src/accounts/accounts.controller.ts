import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AccountDto } from '@kitchen/shared';
import { AdminOnly, CurrentUser, type RequestUser } from '../auth/request-user.js';
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

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string, @CurrentUser() actor: RequestUser): Promise<AccountDto> {
    return this.accounts.revoke(id, actor.id);
  }
}
