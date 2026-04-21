import type { ApiErr } from '@cepage/shared-core';
import type { StatusDescriptor } from './workspace-types';

const DOMAIN = /^[A-Z][A-Z0-9_]*$/;

export function statusFromApiErr(e: ApiErr['error']): StatusDescriptor {
  if (e.key) {
    return { key: e.key, params: e.params, fallback: e.message };
  }
  if (DOMAIN.test(e.message)) {
    return { key: `errors.codes.${e.message}`, fallback: e.message };
  }
  return {
    key: 'errors.codes.HTTP_ERROR',
    params: { message: e.message },
    fallback: e.message,
  };
}

export function statusFromThrown(errorValue: unknown): StatusDescriptor {
  const msg = errorValue instanceof Error ? errorValue.message : String(errorValue);
  return {
    key: 'errors.codes.GENERIC',
    params: { message: msg },
    fallback: msg,
  };
}
