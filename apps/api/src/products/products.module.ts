import { Module } from '@nestjs/common';
import { NutritionBackfillService } from './nutrition-backfill.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, NutritionBackfillService],
  exports: [ProductsService],
})
export class ProductsModule {}
