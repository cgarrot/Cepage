import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhooksDeliveryService, type FetchLike } from '../webhooks.delivery.js';
import { verifySignature } from '../webhooks.signer.js';
import type { WebhookRow } from '../webhooks.dto.js';

// Build a concrete WebhookRow with a secret so we don't pay the cost of
// spinning up a full Nest test module. The service is a pure unit; all
// async behavior flows through the injected `fetchImpl` + `sleep`.
function mockPrismaService() {
  return {
    webhookDeliveryAttempt: {
      create: async () => undefined,
    },
  } as unknown as import('../../../common/database/prisma.service.js').PrismaService;
}

function makeSubscription(
  overrides: Partial<WebhookRow & { secret: string }> = {},
): WebhookRow & { secret: string } {
  return {
    id: 'sub_1',
    url: 'https://example.invalid/webhook',
    events: ['skill-run.succeeded'],
    skillId: null,
    active: true,
    description: null,
    secret: 'whsec_test',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}

test('deliver succeeds on first attempt and signs the payload correctly', async () => {
  const svc = new WebhooksDeliveryService(mockPrismaService());
  let seenUrl = '';
  let seenBody = '';
  let seenSignature = '';
  const fetchImpl: FetchLike = async (url, init) => {
    seenUrl = url;
    seenBody = init.body;
    seenSignature = init.headers['cepage-signature'] ?? '';
    return { status: 202, text: async () => '' };
  };

  const subscription = makeSubscription();
  const delivery = {
    id: 'delivery_1',
    type: 'skill-run.succeeded' as const,
    createdAt: '2026-04-21T12:00:00.000Z',
    data: { runId: 'run_1' },
  };

  const result = await svc.deliver(subscription, delivery, {
    fetchImpl,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
  });

  assert.equal(result.status, 'delivered');
  assert.equal(result.httpStatus, 202);
  assert.equal(result.attempts.length, 1);
  assert.equal(seenUrl, subscription.url);
  assert.equal(seenBody, JSON.stringify(delivery));
  assert.ok(seenSignature.startsWith('v1,t='));

  assert.equal(
    verifySignature({
      secret: subscription.secret,
      body: seenBody,
      header: seenSignature,
      now: 1_700_000_000,
      toleranceSec: 300,
    }),
    true,
  );
});

test('deliver retries on 5xx and reports per-attempt status', async () => {
  const svc = new WebhooksDeliveryService(mockPrismaService());
  let call = 0;
  const fetchImpl: FetchLike = async () => {
    call += 1;
    if (call < 3) return { status: 503, text: async () => '' };
    return { status: 200, text: async () => '' };
  };
  const subscription = makeSubscription();

  const result = await svc.deliver(
    subscription,
    svcBuildDelivery('skill-run.succeeded', { runId: 'run_2' }),
    {
      fetchImpl,
      sleep: async () => undefined,
      retries: 3,
      backoffMs: [0, 1, 2, 4],
      now: () => 1_700_000_000_000,
    },
  );

  assert.equal(result.status, 'delivered');
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(
    result.attempts.map((a) => a.status),
    [503, 503, 200],
  );
});

test('deliver returns failed after exhausting retries', async () => {
  const svc = new WebhooksDeliveryService(mockPrismaService());
  const fetchImpl: FetchLike = async () => ({ status: 500, text: async () => '' });
  const subscription = makeSubscription();

  const result = await svc.deliver(
    subscription,
    svcBuildDelivery('skill-run.failed', { runId: 'run_3' }),
    {
      fetchImpl,
      sleep: async () => undefined,
      retries: 2,
      backoffMs: [0, 1, 2],
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.httpStatus, 500);
  assert.equal(result.attempts.length, 3);
  for (const attempt of result.attempts) assert.equal(attempt.error, 'Non-2xx response (500)');
});

test('deliver treats network errors as retryable', async () => {
  const svc = new WebhooksDeliveryService(mockPrismaService());
  let call = 0;
  const fetchImpl: FetchLike = async () => {
    call += 1;
    if (call === 1) throw new Error('ECONNRESET');
    return { status: 200, text: async () => '' };
  };
  const subscription = makeSubscription();

  const result = await svc.deliver(
    subscription,
    svcBuildDelivery('skill-run.started', { runId: 'run_4' }),
    {
      fetchImpl,
      sleep: async () => undefined,
      retries: 2,
      backoffMs: [0, 0, 0],
    },
  );

  assert.equal(result.status, 'delivered');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, null);
  assert.match(result.attempts[0].error ?? '', /ECONNRESET/);
  assert.equal(result.attempts[1].status, 200);
});

function svcBuildDelivery(type: string, data: unknown) {
  return {
    id: `del_${type}`,
    type,
    createdAt: '2026-04-21T12:00:00.000Z',
    data,
  };
}
