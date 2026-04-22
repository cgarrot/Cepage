// Error classes surfaced by the Cepage SDK.
//
// The SDK deliberately keeps zero runtime dependencies, so these are
// plain `Error` subclasses. They're designed so callers can discriminate
// between "network / transport failure" and "the Cepage server returned
// a structured failure" with a simple `instanceof` check.

export interface CepageErrorPayload {
  code?: string;
  message?: string;
  errors?: Array<{
    path?: string;
    message?: string;
    keyword?: string;
    params?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

export class CepageHttpError extends Error {
  readonly status: number;
  readonly body: CepageErrorPayload | string | null;

  constructor(status: number, message: string, body: CepageErrorPayload | string | null) {
    super(message);
    this.name = 'CepageHttpError';
    this.status = status;
    this.body = body;
  }
}

export class CepageValidationError extends CepageHttpError {
  readonly errors: NonNullable<CepageErrorPayload['errors']>;

  constructor(status: number, message: string, body: CepageErrorPayload) {
    super(status, message, body);
    this.name = 'CepageValidationError';
    this.errors = body.errors ?? [];
  }
}

export class CepageTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CepageTimeoutError';
  }
}

export function isCepageError(err: unknown): err is CepageHttpError {
  return err instanceof CepageHttpError;
}

export function isCepageValidationError(err: unknown): err is CepageValidationError {
  return err instanceof CepageValidationError;
}
