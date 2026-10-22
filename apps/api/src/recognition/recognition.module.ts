import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { GeminiService } from '../gemini/gemini.service.js';
import { ProductsModule } from '../products/products.module.js';
import { OpenFoodFactsClient } from './open-food-facts.client.js';
import { createRecognitionProvider } from './providers/provider.factory.js';
import { RECOGNITION_PROVIDER } from './providers/recognition-provider.js';
import { RecognitionService } from './recognition.service.js';
import { ScanController } from './scan.controller.js';

@Module({
  imports: [ProductsModule],
  controllers: [ScanController],
  providers: [
    RecognitionService,
    OpenFoodFactsClient,
    {
      provide: RECOGNITION_PROVIDER,
      inject: [APP_CONFIG, GeminiService],
      useFactory: (config: AppConfig, gemini: GeminiService) => createRecognitionProvider(config, gemini.http),
    },
  ],
  exports: [RecognitionService],
})
export class RecognitionModule {}
