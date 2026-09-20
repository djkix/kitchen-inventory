import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
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
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: (config: AppConfig, http: HttpClient) => createRecognitionProvider(config, http),
    },
  ],
  exports: [RecognitionService],
})
export class RecognitionModule {}
