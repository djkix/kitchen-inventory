import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createServiceTokenSchema, type CreateServiceTokenInput } from '@kitchen/shared';
import { AdminOnly } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { ServiceTokensService, type ServiceTokenDto } from './service-tokens.service.js';

@AdminOnly()
@Controller('service-tokens')
export class ServiceTokensController {
  constructor(private readonly tokens: ServiceTokensService) {}

  @Get()
  list(): Promise<ServiceTokenDto[]> {
    return this.tokens.list();
  }

  @Post()
  create(@ZodBody(createServiceTokenSchema) body: CreateServiceTokenInput): Promise<ServiceTokenDto & { token: string }> {
    return this.tokens.create(body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.tokens.remove(id);
  }
}
