import type { ApiResponse, ErrOpts } from '@cepage/shared-core';
import { getApiBaseUrl } from './config';

function apiErr<T>(
  code: string,
  message: string,
  opts?: ErrOpts,
): ApiResponse<T> {
  return {
    success: false,
    error: {
      code,
      message,
      details: opts?.details,
      retryable: opts?.retryable,
      key: opts?.key,
      params: opts?.params,
    },
  };
}

async function parse<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  let parsed: unknown = undefined;

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    return parsed as ApiResponse<T>;
  }

  const fallbackMessage = text || res.statusText || 'Request failed';
  if (!res.ok) {
    const code = String(res.status);
    const known = new Set(['400', '401', '403', '404', '409', '422', '500']);
    const key = known.has(code) ? `errors.httpStatus.${code}` : 'errors.httpStatus.default';
    return apiErr(`HTTP_${res.status}`, fallbackMessage, {
      details: { status: res.status },
      retryable: res.status >= 500,
      key,
      params: { message: fallbackMessage, code },
    });
  }

  return apiErr('INVALID_API_RESPONSE', fallbackMessage, {
    details: { status: res.status },
    key: 'errors.codes.INVALID_API_RESPONSE',
    params: { message: fallbackMessage },
  });
}

function asNetworkError<T>(errorValue: unknown): ApiResponse<T> {
  const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
  return apiErr('NETWORK_ERROR', message, {
    retryable: true,
    key: 'errors.codes.NETWORK_ERROR',
    params: { message },
  });
}

export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, { credentials: 'include' });
    return parse<T>(res);
  } catch (errorValue) {
    return asNetworkError<T>(errorValue);
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return parse<T>(res);
  } catch (errorValue) {
    return asNetworkError<T>(errorValue);
  }
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      credentials: 'include',
      body,
    });
    return parse<T>(res);
  } catch (errorValue) {
    return asNetworkError<T>(errorValue);
  }
}

export async function apiPatch<T>(path: string, bodyRecord: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(bodyRecord),
    });
    return parse<T>(res);
  } catch (errorValue) {
    return asNetworkError<T>(errorValue);
  }
}

export async function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return parse<T>(res);
  } catch (errorValue) {
    return asNetworkError<T>(errorValue);
  }
}
