import { Body, Controller, Get, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { scanBarcodeSchema, scanCorrectionSchema, scanImageHintSchema, type RecognitionStats, type ScanBarcodeInput, type ScanBarcodeResult, type ScanCorrectionInput, type ScanImageResult } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { ZodBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MediaService } from '../media/media.service.js';
import { RecognitionService } from './recognition.service.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

@Controller()
export class ScanController {
  constructor(
    private readonly recognition: RecognitionService,
    private readonly media: MediaService,
  ) {}

  @Post('scan/barcode')
  @HttpCode(200)
  async barcode(@ZodBody(scanBarcodeSchema) body: ScanBarcodeInput): Promise<ScanBarcodeResult> {
    const result = await this.recognition.resolveBarcode(body.barcode);
    if (!result) throw ApiError.notFound('Code-barres inconnu', { barcode: body.barcode });
    return result;
  }

  /** Section 10 : seule route qui engage un coût externe, donc limitée par adresse. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('scan/image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async image(@UploadedFile() file: Express.Multer.File | undefined, @Body() rawBody: unknown): Promise<ScanImageResult> {
    if (!file) throw new ApiError(400, 'validation_failed', 'Photo manquante (champ « image »)');
    if (!this.media.isSupportedMime(file.mimetype)) {
      throw new ApiError(400, 'validation_failed', 'Format d’image non pris en charge (JPEG, PNG, WebP, HEIC)', [{ path: 'image', message: file.mimetype }]);
    }
    const hint = new ZodValidationPipe(scanImageHintSchema).transform(rawBody);
    return this.recognition.recognizeImage(file.buffer, file.mimetype, hint.hint, hint.barcode);
  }

  @Post('scan/corrections')
  @HttpCode(204)
  correction(@ZodBody(scanCorrectionSchema) body: ScanCorrectionInput): Promise<void> {
    return this.recognition.recordCorrection(body.rawId, body.productId);
  }

  @Get('recognition/stats')
  stats(): Promise<RecognitionStats> {
    return this.recognition.stats();
  }
}
