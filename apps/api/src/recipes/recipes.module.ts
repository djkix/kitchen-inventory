import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';
import { RecipesStatsService } from './recipes.stats.js';

@Module({
  imports: [SettingsModule],
  controllers: [RecipesController],
  providers: [RecipesService, RecipesStatsService],
  exports: [RecipesService, RecipesStatsService],
})
export class RecipesModule {}
