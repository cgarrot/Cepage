import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { err } from '@cepage/shared-core';

const DOMAIN = /^[A-Z][A-Z0-9_]*$/;

function extractMessage(exResponse: unknown): string {
  if (typeof exResponse === 'string') return exResponse;
  if (exResponse && typeof exResponse === 'object' && 'message' in exResponse) {
    const message = (exResponse as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.map(String).join(', ');
    if (typeof message === 'string') return message;
  }
  return 'HTTP_ERROR';
}

function validationDetail(exResponse: unknown): string | undefined {
  if (!exResponse || typeof exResponse !== 'object') return undefined;
  const o = exResponse as { errors?: unknown };
  if (o.errors === undefined) return undefined;
  try {
    return JSON.stringify(o.errors);
  } catch {
    return String(o.errors);
  }
}

function i18nForHttp(msg: string, exResponse: unknown): { key: string; params?: Record<string, unknown> } {
  const valDetail = validationDetail(exResponse);
  if (msg === 'VALIDATION_FAILED' && valDetail) {
    return { key: 'errors.codes.VALIDATION_FAILED', params: { detail: valDetail } };
  }
  if (DOMAIN.test(msg)) {
    return { key: `errors.codes.${msg}` };
  }
  return { key: 'errors.codes.HTTP_ERROR', params: { message: msg } };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exResponse = exception.getResponse();
      const msg = extractMessage(exResponse);
      const { key, params } = i18nForHttp(msg, exResponse);
      res.status(status).json(
        err('HTTP_ERROR', msg, {
          details: { status },
          retryable: status >= 500,
          key,
          params,
        }),
      );
      return;
    }

    const raw = exception instanceof Error ? exception.message : 'Unknown error';
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      err('INTERNAL_ERROR', raw, {
        retryable: true,
        key: 'errors.codes.INTERNAL_ERROR',
        params: { message: raw },
      }),
    );
  }
}
