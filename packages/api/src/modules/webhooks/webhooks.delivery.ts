import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { signPayload } from './webhooks.signer';
import type { WebhookDelivery, WebhookRow } from './webhooks.dto';

// Node 20's global fetch is nominally sufficient, but the module is
// tested by swapping the transport wholesale. Exposing a narrow
// FetchLike keeps the happy path simple and unit tests deterministic.
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface DeliveryOptions {
  // Per-call overrides for tests. Subject to product-wide defaults:
  //   retries: 3  (retry 4 times total, including first attempt)
  //   backoffMs: [0, 1_000, 5_000, 15_000]
  //   timeoutMs: 10_000
  retries?: number;
  backoffMs?: readonly number[];
  timeoutMs?: number;
  /** Optional override of `fetch` — primarily for tests. */
  fetchImpl?: FetchLike;
  /** Sleep helper — override for tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Override timestamp used when signing payloads. */
  now?: () => number;
}

export interface DeliveryAttempt {
  attempt: number;
  status: number | null;
  durationMs: number;
  error: string | null;
}

export interface DeliveryResult {
  deliveryId: string;
  url: string;
  status: 'delivered' | 'failed';
  httpStatus: number | null;
  attempts: DeliveryAttempt[];
}

const DEFAULT_BACKOFF_MS = [0, 1_000, 5_000, 15_000] as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;

@Injectable()
export class WebhooksDeliveryService {
  private readonly log = new Logger(WebhooksDeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deliver(
    subscription: WebhookRow & { secret: string },
    delivery: WebhookDelivery,
    options: DeliveryOptions = {},
  ): Promise<DeliveryResult> {
    const retries = options.retries ?? DEFAULT_RETRIES;
    const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const sleep = options.sleep ?? defaultSleep;
    const doFetch = options.fetchImpl ?? fetchAsLike;
    const now = options.now ?? (() => Date.now());

    const body = JSON.stringify(delivery);
    const signed = signPayload({
      secret: subscription.secret,
      body,
      timestamp: Math.floor(now() / 1000),
    });
    const deliveryId = delivery.id || randomUUID();

    const attempts: DeliveryAttempt[] = [];
    const maxAttempts = Math.max(1, retries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const wait = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      if (wait > 0) await sleep(wait);

      const started = now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.max(500, timeoutMs));
      let status: number | null = null;
      let error: string | null = null;
      let responseBody: string | null = null;

      try {
        const response = await doFetch(subscription.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'cepage-webhook/1',
            accept: 'application/json',
            'cepage-event': delivery.type,
            'cepage-delivery': deliveryId,
            'cepage-subscription': subscription.id,
            'cepage-signature': signed.header,
          },
          body,
          signal: ac.signal,
        });
        status = response.status;
        try {
          responseBody = await response.text();
        } catch {
          responseBody = null;
        }
        if (status >= 200 && status < 300) {
          attempts.push({
            attempt,
            status,
            durationMs: now() - started,
            error: null,
          });
          clearTimeout(timer);
          await this.prisma.webhookDeliveryAttempt.create({
            data: {
              webhookSubscriptionId: subscription.id,
              event: delivery.type,
              payload: delivery as unknown as Prisma.InputJsonValue,
              responseStatus: status,
              responseBody,
              error: null,
              succeededAt: new Date(),
            },
          });
          return {
            deliveryId,
            url: subscription.url,
            status: 'delivered',
            httpStatus: status,
            attempts,
          };
        }
        error = `Non-2xx response (${status})`;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }

      attempts.push({
        attempt,
        status,
        durationMs: now() - started,
        error,
      });

      await this.prisma.webhookDeliveryAttempt.create({
        data: {
          webhookSubscriptionId: subscription.id,
          event: delivery.type,
          payload: delivery as unknown as Prisma.InputJsonValue,
          responseStatus: status,
          responseBody,
          error,
          succeededAt: null,
        },
      });

      this.log.warn(
        `[webhooks] delivery attempt ${attempt}/${maxAttempts} for subscription=${subscription.id} event=${delivery.type} failed: ${error}`,
      );
    }

    return {
      deliveryId,
      url: subscription.url,
      status: 'failed',
      httpStatus: attempts[attempts.length - 1]?.status ?? null,
      attempts,
    };
  }
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const fetchAsLike: FetchLike = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  return res;
};
