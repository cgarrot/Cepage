import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SkillRunsService, type SkillRunEvent } from '../skill-runs/skill-runs.service';
import { WebhooksDeliveryService } from './webhooks.delivery';
import { WebhooksService } from './webhooks.service';

// Glue between the SkillRuns event bus and the webhooks subscription table.
//
// On module init, we attach a single `event` listener on the global
// SkillRunsService emitter. For each event, we look up the active
// subscriptions that match (skillId filter + events array), fan out
// deliveries in parallel, and log the aggregated outcome.
//
// Delivery failures never propagate back to the skill run: webhooks are
// best-effort, and a bad subscriber must not block or fail a successful
// skill execution. The dispatcher traps all errors locally.

type MappedEvent = {
  name: string;
  skillId: string | null;
  data: Record<string, unknown>;
};

@Injectable()
export class WebhooksDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebhooksDispatcher.name);
  private listener: ((event: SkillRunEvent) => void) | null = null;

  constructor(
    private readonly runs: SkillRunsService,
    private readonly webhooks: WebhooksService,
    private readonly delivery: WebhooksDeliveryService,
  ) {}

  onModuleInit(): void {
    const listener = (event: SkillRunEvent): void => {
      void this.handle(event).catch((err) => {
        this.log.warn(
          `[webhooks-dispatch] handler failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    };
    this.runs.events.on('event', listener);
    this.listener = listener;
  }

  onModuleDestroy(): void {
    if (this.listener) {
      this.runs.events.off('event', this.listener);
      this.listener = null;
    }
  }

  // Visible for tests — lets the suite exercise the full pipeline without
  // having to fire fake SkillRunEvents through the actual EventEmitter.
  async handle(event: SkillRunEvent): Promise<void> {
    const mapped = mapEvent(event);
    if (!mapped) return;

    const subscribers = await this.webhooks.findActiveFor(mapped.name, mapped.skillId);
    if (subscribers.length === 0) return;

    const delivery = this.webhooks.buildDelivery(mapped.name, mapped.data);

    await Promise.allSettled(
      subscribers.map((sub) =>
        this.delivery.deliver(sub, delivery).catch((err) => {
          // The delivery service already logs failures internally; we
          // only surface crashes (which would indicate a bug in signing
          // or subscription shape) here.
          this.log.error(
            `[webhooks-dispatch] crash delivering ${mapped.name} to ${sub.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return null;
        }),
      ),
    );
  }
}

function mapEvent(event: SkillRunEvent): MappedEvent | null {
  switch (event.type) {
    case 'started':
      return {
        name: 'skill-run.started',
        skillId: event.skillId,
        data: { runId: event.runId, skillId: event.skillId },
      };
    case 'progress':
      return {
        name: 'skill-run.progress',
        skillId: event.skillId,
        data: { runId: event.runId, skillId: event.skillId, message: event.message },
      };
    case 'succeeded':
      return {
        name: 'skill-run.succeeded',
        skillId: event.skillId,
        data: {
          runId: event.runId,
          skillId: event.skillId,
          outputs: event.outputs,
        },
      };
    case 'failed':
      return {
        name: 'skill-run.failed',
        skillId: event.skillId,
        data: {
          runId: event.runId,
          skillId: event.skillId,
          error: event.error,
        },
      };
    case 'cancelled':
      return {
        name: 'skill-run.cancelled',
        skillId: event.skillId,
        data: { runId: event.runId, skillId: event.skillId },
      };
    default:
      return null;
  }
}
