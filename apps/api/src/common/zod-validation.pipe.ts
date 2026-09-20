import { Body, Param, PipeTransform, Query } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError } from './api-error.js';

/**
 * Valide un corps, une requête ou un paramètre avec un schéma Zod du paquet
 * partagé. Les erreurs deviennent `400 validation_failed` avec la liste des
 * champs fautifs dans `details`.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new ApiError(
      400,
      'validation_failed',
      'Corps de requête invalide',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
}

export const ZodBody = <T>(schema: ZodType<T>): ParameterDecorator => Body(new ZodValidationPipe(schema));
export const ZodQuery = <T>(schema: ZodType<T>): ParameterDecorator => Query(new ZodValidationPipe(schema));
export const ZodParam = <T>(name: string, schema: ZodType<T>): ParameterDecorator => Param(name, new ZodValidationPipe(schema));
