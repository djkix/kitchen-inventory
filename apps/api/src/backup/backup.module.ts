import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller.js';

@Module({ controllers: [BackupController] })
export class BackupModule {}
