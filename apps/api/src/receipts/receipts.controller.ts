import { Controller, Get, HttpCode, Param, Post, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { createReceiptSchema, type ReceiptDto } from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RECEIPT_MIME_TYPES } from './gemini-receipt.reader.js';
import { ReceiptsService } from './receipts.service.js';

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** Engage un coût externe, donc limitée par adresse comme le scan photo. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 } }))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() rawBody: unknown, @CurrentUser() user: RequestUser): Promise<ReceiptDto> {
    if (!file) throw new ApiError(400, 'validation_failed', 'Ticket manquant (champ « file »)');
    if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new ApiError(400, 'validation_failed', 'Format non pris en charge (JPEG, PNG, WebP, HEIC ou PDF)', [{ path: 'file', message: file.mimetype }]);
    }
    const { locationId } = new ZodValidationPipe(createReceiptSchema).transform(rawBody);
    return this.receipts.read(file.buffer, file.mimetype, locationId, user.id);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ReceiptDto> {
    return this.receipts.get(id);
  }
}
