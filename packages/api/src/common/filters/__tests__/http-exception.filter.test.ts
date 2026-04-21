import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpExceptionFilter } from '../http-exception.filter';

function captureResponse(): {
  res: { statusCode: number; body: unknown };
  host: ArgumentsHost;
} {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { res: res as { statusCode: number; body: unknown }, host };
}

test('HttpExceptionFilter maps NotFound domain token to i18n key', () => {
  const filter = new HttpExceptionFilter();
  const { res, host } = captureResponse();
  filter.catch(new NotFoundException('SESSION_NOT_FOUND'), host);
  const body = res.body as {
    success: false;
    error: { key?: string; message: string };
  };
  assert.equal(body.success, false);
  assert.equal(body.error.key, 'errors.codes.SESSION_NOT_FOUND');
});

test('HttpExceptionFilter maps validation shape to VALIDATION_FAILED key', () => {
  const filter = new HttpExceptionFilter();
  const { res, host } = captureResponse();
  filter.catch(
    new BadRequestException({
      message: 'VALIDATION_FAILED',
      errors: [{ field: 'name', messages: ['too short'] }],
    }),
    host,
  );
  const body = res.body as { success: false; error: { key?: string } };
  assert.equal(body.error.key, 'errors.codes.VALIDATION_FAILED');
});

test('HttpExceptionFilter maps unknown prose to HTTP_ERROR key', () => {
  const filter = new HttpExceptionFilter();
  const { res, host } = captureResponse();
  filter.catch(new HttpException('nope', 418), host);
  const body = res.body as { success: false; error: { key?: string } };
  assert.equal(body.error.key, 'errors.codes.HTTP_ERROR');
});
