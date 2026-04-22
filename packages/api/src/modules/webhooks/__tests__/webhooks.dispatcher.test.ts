import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhooksDispatcher } from '../webhooks.dispatcher.js';
import type { SkillRunEvent, SkillRunsService } from '../../skill-runs/skill-runs.service.js';
import type { WebhooksService } from '../webhooks.service.js';
import type { WebhooksDeliveryService } from '../webhooks.delivery.js';
import type { WebhookDelivery, WebhookRow } from '../webhooks.dto.js';

// Scenario: verify the dispatcher maps SkillRunEvents to the correct
// event names and only dispatches to matching subscriptions. We stub
// out SkillRunsService/WebhooksService/WebhooksDeliveryService and
// drive the pipeline by calling the (exported-for-testing) `handle`
// method directly — no timers, no database.

class StubWebhooksService {
  subscriptions: (WebhookRow & { secret: string })[] = [];
  findActiveForCalls: { event: string; skillId: string | null }[] = [];
  deliveries: WebhookDelivery[] = [];

  async findActiveFor(event: string, skillId: string | null) {
    this.findActiveForCalls.push({ event, skillId });
    return this.subscriptions.filter((sub) => {
      if (sub.skillId && skillId && sub.skillId !== skillId) return false;
      if (sub.events.length === 0) return true;
      return sub.events.includes(event) || sub.events.includes('*');
    });
  }

  buildDelivery<TData>(type: string, data: TData): WebhookDelivery<TData> {
    const d = {
      id: `del_${this.deliveries.length + 1}`,
      type,
      createdAt: '2026-04-21T12:00:00.000Z',
      data,
    };
    this.deliveries.push(d as WebhookDelivery);
    return d;
  }
}

class StubDelivery {
  invocations: { subId: string; type: string; data: unknown }[] = [];

  async deliver(
    sub: WebhookRow & { secret: string },
    delivery: WebhookDelivery,
  ) {
    this.invocations.push({
      subId: sub.id,
      type: delivery.type,
      data: delivery.data,
    });
    return {
      deliveryId: delivery.id,
      url: sub.url,
      status: 'delivered' as const,
      httpStatus: 200,
      attempts: [],
    };
  }
}

function makeDispatcher() {
  const webhooks = new StubWebhooksService();
  const delivery = new StubDelivery();
  // We don't invoke onModuleInit(), so the SkillRunsService stub just
  // needs to satisfy the typing; we drive the pipeline with handle().
  const runs = { events: { on: () => undefined, off: () => undefined } } as unknown as SkillRunsService;
  const dispatcher = new WebhooksDispatcher(
    runs,
    webhooks as unknown as WebhooksService,
    delivery as unknown as WebhooksDeliveryService,
  );
  return { dispatcher, webhooks, delivery };
}

function makeSubscription(
  overrides: Partial<WebhookRow & { secret: string }> = {},
): WebhookRow & { secret: string } {
  return {
    id: 'sub_x',
    url: 'https://example.invalid/hook',
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

test('dispatcher fans out succeeded events to all matching subscriptions', async () => {
  const { dispatcher, webhooks, delivery } = makeDispatcher();
  webhooks.subscriptions = [
    makeSubscription({ id: 'sub_all', skillId: null, events: ['*'] }),
    makeSubscription({ id: 'sub_typed', events: ['skill-run.succeeded'] }),
    makeSubscription({ id: 'sub_failed', events: ['skill-run.failed'] }),
  ];

  const event: SkillRunEvent = {
    type: 'succeeded',
    runId: 'run_1',
    skillId: 'weekly-report',
    outputs: { sessionId: 'ses_1' },
  };

  await dispatcher.handle(event);

  assert.deepEqual(
    delivery.invocations.map((i) => i.subId).sort(),
    ['sub_all', 'sub_typed'],
  );
  for (const invocation of delivery.invocations) {
    assert.equal(invocation.type, 'skill-run.succeeded');
    assert.deepEqual(invocation.data, {
      runId: 'run_1',
      skillId: 'weekly-report',
      outputs: { sessionId: 'ses_1' },
    });
  }
});

test('dispatcher respects skillId filters', async () => {
  const { dispatcher, webhooks, delivery } = makeDispatcher();
  webhooks.subscriptions = [
    makeSubscription({ id: 'sub_weekly', skillId: 'weekly-report' }),
    makeSubscription({ id: 'sub_other', skillId: 'daily-digest' }),
    makeSubscription({ id: 'sub_global', skillId: null }),
  ];

  await dispatcher.handle({
    type: 'succeeded',
    runId: 'run_1',
    skillId: 'weekly-report',
    outputs: {},
  });

  assert.deepEqual(
    delivery.invocations.map((i) => i.subId).sort(),
    ['sub_global', 'sub_weekly'],
  );
});

test('dispatcher maps every SkillRunEvent type to the right webhook event', async () => {
  const { dispatcher, webhooks, delivery } = makeDispatcher();
  webhooks.subscriptions = [makeSubscription({ id: 'sub_all', events: ['*'] })];

  const events: SkillRunEvent[] = [
    { type: 'started', runId: 'r1', skillId: 's1' },
    { type: 'progress', runId: 'r1', skillId: 's1', message: 'hello' },
    { type: 'succeeded', runId: 'r1', skillId: 's1', outputs: {} },
    { type: 'failed', runId: 'r1', skillId: 's1', error: { code: 'X', message: 'y' } },
    { type: 'cancelled', runId: 'r1', skillId: 's1' },
  ];

  for (const event of events) {
    await dispatcher.handle(event);
  }

  assert.deepEqual(
    delivery.invocations.map((i) => i.type),
    [
      'skill-run.started',
      'skill-run.progress',
      'skill-run.succeeded',
      'skill-run.failed',
      'skill-run.cancelled',
    ],
  );
});

test('dispatcher does not throw when delivery crashes — best effort only', async () => {
  const { webhooks } = makeDispatcher();
  const exploder = {
    deliver: async () => {
      throw new Error('network is on fire');
    },
  };
  const dispatcherWithBoom = new WebhooksDispatcher(
    { events: { on: () => undefined, off: () => undefined } } as unknown as SkillRunsService,
    webhooks as unknown as WebhooksService,
    exploder as unknown as WebhooksDeliveryService,
  );
  webhooks.subscriptions = [makeSubscription({ id: 'sub_crash', events: ['*'] })];

  await assert.doesNotReject(
    dispatcherWithBoom.handle({
      type: 'succeeded',
      runId: 'r',
      skillId: 's',
      outputs: {},
    }),
  );
});
