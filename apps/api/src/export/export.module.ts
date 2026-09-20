import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';

@Module({ controllers: [ExportController] })
export class ExportModule {}
