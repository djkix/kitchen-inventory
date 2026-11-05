import { Global, Module } from '@nestjs/common';
import { GeminiService } from './gemini.service.js';

/** Global : la reconnaissance, les tickets et les suggestions passent tous par le même limiteur. */
@Global()
@Module({ providers: [GeminiService], exports: [GeminiService] })
export class GeminiModule {}
