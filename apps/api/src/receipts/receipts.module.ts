import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { GeminiService } from '../gemini/gemini.service.js';
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
      inject: [APP_CONFIG, GeminiService],
      useFactory: (config: AppConfig, gemini: GeminiService) =>
        new GeminiReceiptReader({
          apiKey: config.VISION_PROVIDER === 'gemini' ? config.VISION_API_KEY : undefined,
          baseURL: config.VISION_PROVIDER === 'gemini' ? config.VISION_BASE_URL : undefined,
          httpClient: gemini.http,
        }),
    },
  ],
})
export class ReceiptsModule {}
