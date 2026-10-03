import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { RecipeLogRatingsController, RecipeLogsController } from './recipe-logs.controller.js';
import { RecipeLogsService } from './recipe-logs.service.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesService } from './recipes.service.js';
import { RecipesStatsService } from './recipes.stats.js';

@Module({
  imports: [SettingsModule],
  controllers: [RecipesController, RecipeLogsController, RecipeLogRatingsController],
  providers: [RecipesService, RecipesStatsService, RecipeLogsService],
  exports: [RecipesService, RecipesStatsService, RecipeLogsService],
})
export class RecipesModule {}
