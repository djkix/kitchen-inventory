import { Controller, Get } from '@nestjs/common';
import type { CategoryDto } from '@kitchen/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => ({ id: c.id, name: c.name, icon: c.icon, shelfLifeDays: c.shelfLifeDays, afterOpeningDays: c.afterOpeningDays }));
  }
}
