import { Body, Controller, Get, Post } from '@nestjs/common';
import { createCuisineSchema, normalizeProductName, type CreateCuisineInput } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CuisineDto {
  id: string;
  name: string;
  region: string | null;
}

/** Référentiel des cuisines (section 12), extensible par les membres du foyer. */
@Controller('cuisines')
export class CuisinesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<CuisineDto[]> {
    const rows = await this.prisma.cuisine.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => ({ id: c.id, name: c.name, region: c.region }));
  }

  @Post()
  async create(@ZodBody(createCuisineSchema) body: CreateCuisineInput): Promise<CuisineDto> {
    const normalizedName = normalizeProductName(body.name);
    const existing = await this.prisma.cuisine.findUnique({ where: { normalizedName } });
    if (existing) throw ApiError.conflict('Cette cuisine existe déjà');
    const created = await this.prisma.cuisine.create({ data: { name: body.name, normalizedName, region: body.region ?? null } });
    return { id: created.id, name: created.name, region: created.region };
  }
}
