import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { RecipeLogRatingsController, RecipeLogsController } from './recipe-logs.controller.js';
import { RecipeLogsService } from './recipe-logs.service.js';
import { RecipesCookService } from './recipes.cook.js';
import { RecipesController } from './recipes.controller.js';
import { RecipesCoverageService } from './recipes.coverage.js';
import { RecipesService } from './recipes.service.js';
import { RecipesStatsService } from './recipes.stats.js';

@Module({
  imports: [SettingsModule],
  controllers: [RecipesController, RecipeLogsController, RecipeLogRatingsController],
  providers: [RecipesService, RecipesStatsService, RecipesCoverageService, RecipeLogsService, RecipesCookService],
  exports: [RecipesService, RecipesStatsService, RecipesCoverageService, RecipeLogsService, RecipesCookService],
})
export class RecipesModule {}
