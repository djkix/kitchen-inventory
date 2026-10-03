import { Module } from '@nestjs/common';
import { CuisinesController } from './cuisines.controller.js';

@Module({ controllers: [CuisinesController] })
export class CuisinesModule {}
