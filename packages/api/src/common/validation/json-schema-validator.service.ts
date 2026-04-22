import { Injectable } from '@nestjs/common';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

// Centralized ajv-backed validator for typed skill inputs/outputs.
// Caches compiled schemas by stable JSON key so hot paths avoid recompiling
// the same schema on every call. See docs/product-plan/03-typed-skill-contract.md.

export type JsonSchemaValidationError = {
  path: string;
  message: string;
  keyword?: string;
  params?: Record<string, unknown>;
};

export type JsonSchemaValidationResult =
  | { ok: true; data: unknown }
  | { ok: false; errors: JsonSchemaValidationError[] };

@Injectable()
export class JsonSchemaValidatorService {
  private readonly ajv: Ajv;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      useDefaults: true,
      coerceTypes: false,
    });
    addFormats(this.ajv);
  }

  validate(schema: unknown, data: unknown, cacheKey?: string): JsonSchemaValidationResult {
    const validator = this.compile(schema, cacheKey);
    const valid = validator(data);
    if (valid) {
      return { ok: true, data };
    }
    const errors: JsonSchemaValidationError[] = (validator.errors ?? []).map((err) => ({
      path: (err.instancePath || '/').replace(/^\//, '').replace(/\//g, '.') || '(root)',
      message: err.message ?? 'invalid',
      keyword: err.keyword,
      params: err.params as Record<string, unknown> | undefined,
    }));
    return { ok: false, errors };
  }

  private compile(schema: unknown, cacheKey?: string): ValidateFunction {
    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    const validator = this.ajv.compile(schema as object);
    if (cacheKey) {
      this.cache.set(cacheKey, validator);
    }
    return validator;
  }

  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
