import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { StockModule } from '../stock/stock.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GeminiReceiptReader } from './gemini-receipt.reader.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';

@Module({
  imports: [SettingsModule, StockModule],
  controllers: [ReceiptsController],
  providers: [
    ReceiptsService,
    {
      provide: GeminiReceiptReader,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: (config: AppConfig, httpClient: HttpClient) =>
        new GeminiReceiptReader({
          apiKey: config.VISION_PROVIDER === 'gemini' ? config.VISION_API_KEY : undefined,
          baseURL: config.VISION_PROVIDER === 'gemini' ? config.VISION_BASE_URL : undefined,
          httpClient,
        }),
    },
  ],
})
export class ReceiptsModule {}
