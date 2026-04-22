import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { WebhooksDeliveryService } from './webhooks.delivery';
import type {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookDelivery,
  WebhookDeliveryAttemptRow,
  WebhookRow,
} from './webhooks.dto';
import { WEBHOOK_EVENT_NAMES } from './webhooks.dto';
import { generateSecret } from './webhooks.signer';

// Persistence + lifecycle for `WebhookSubscription` rows. Responsibilities:
//   1. CRUD with slug-less UUID primary keys.
//   2. Subscribe()/Rotate()/Delete() invalidate nothing — dispatcher reads
//      straight from Postgres, so schema changes are observed on the next
//      delivery attempt without extra cache plumbing.
//   3. Surface a plaintext secret exactly once (on create + rotate); the
//      regular list/get endpoints return the row without the secret so it
//      never leaks into logs or third-party audit traces.
//
// See docs/product-plan/06-distribution-and-integrations.md.

// Mirrors the Prisma `WebhookSubscription` model. Listed explicitly so
// controllers and tests can consume a narrow, platform-agnostic shape
// without dragging in the full Prisma client type graph.
type DbRow = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  skillId: string | null;
  active: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: WebhooksDeliveryService,
  ) {}

  async list(): Promise<WebhookRow[]> {
    const rows = await this.prisma.webhookSubscription.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((row: DbRow) => this.serialize(row, { includeSecret: false }));
  }

  async get(id: string): Promise<WebhookRow> {
    const row = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    return this.serialize(row, { includeSecret: false });
  }

  async create(dto: CreateWebhookDto): Promise<WebhookRow> {
    const events = this.normalizeEvents(dto.events);
    const secret = dto.secret?.trim() || generateSecret();
    const data: Prisma.WebhookSubscriptionUncheckedCreateInput = {
      url: dto.url.trim(),
      secret,
      events,
      skillId: dto.skillId ?? null,
      active: dto.active ?? true,
      description: dto.description?.trim() || null,
    };
    const created = await this.prisma.webhookSubscription.create({ data });
    this.log.log(
      `[webhooks] created subscription ${created.id} url=${created.url} events=[${events.join(',')}]`,
    );
    return this.serialize(created, { includeSecret: true });
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookRow> {
    const current = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('WEBHOOK_NOT_FOUND');

    const updateData: Prisma.WebhookSubscriptionUncheckedUpdateInput = {};
    if (dto.url !== undefined) updateData.url = dto.url.trim();
    if (dto.events !== undefined) updateData.events = this.normalizeEvents(dto.events);
    if (dto.skillId !== undefined) updateData.skillId = dto.skillId;
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.description !== undefined) {
      updateData.description = dto.description?.trim() || null;
    }

    const rotated = dto.secretAction === 'rotate';
    let plainSecretToSurface: string | null = null;
    if (rotated) {
      const next = generateSecret();
      updateData.secret = next;
      plainSecretToSurface = next;
    }

    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: updateData,
    });
    const row = this.serialize(updated, { includeSecret: false });
    if (rotated && plainSecretToSurface) {
      row.secret = plainSecretToSurface;
    }
    return row;
  }

  async remove(id: string): Promise<{ deleted: true }> {
    try {
      await this.prisma.webhookSubscription.delete({ where: { id } });
    } catch {
      throw new NotFoundException('WEBHOOK_NOT_FOUND');
    }
    return { deleted: true as const };
  }

  // ─── dispatcher helpers ──────────────────────────────────────────────

  async findActiveFor(event: string, skillId: string | null): Promise<(WebhookRow & { secret: string })[]> {
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { active: true },
    });
    const out: (WebhookRow & { secret: string })[] = [];
    for (const row of rows as DbRow[]) {
      if (row.skillId && skillId && row.skillId !== skillId) continue;
      const matchesEvent =
        row.events.length === 0 || row.events.includes(event) || row.events.includes('*');
      if (!matchesEvent) continue;
      const serialized = this.serialize(row, { includeSecret: true });
      out.push({ ...serialized, secret: row.secret });
    }
    return out;
  }

  buildDelivery<TData = unknown>(type: string, data: TData): WebhookDelivery<TData> {
    return {
      id: randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      data,
    };
  }

  async ping(id: string): Promise<{
    id: string;
    status: 'delivered' | 'failed';
    httpStatus: number | null;
  }> {
    const row = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    const subscription = this.serialize(row, { includeSecret: true });
    const result = await this.delivery.deliver(
      { ...subscription, secret: row.secret },
      this.buildDelivery('webhook.ping', { subscriptionId: row.id }),
      // Keep ping synchronous with a shortened backoff so the UI's
      // "Test" button feels responsive even when the subscriber is slow.
      { retries: 0, backoffMs: [0] },
    );
    return {
      id: result.deliveryId,
      status: result.status,
      httpStatus: result.httpStatus,
    };
  }

  async listDeliveries(subscriptionId: string): Promise<WebhookDeliveryAttemptRow[]> {
    const rows = await this.prisma.webhookDeliveryAttempt.findMany({
      where: { webhookSubscriptionId: subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.serializeDeliveryAttempt(row));
  }

  async getDelivery(
    subscriptionId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryAttemptRow> {
    const row = await this.prisma.webhookDeliveryAttempt.findFirst({
      where: { id: deliveryId, webhookSubscriptionId: subscriptionId },
    });
    if (!row) throw new NotFoundException('DELIVERY_NOT_FOUND');
    return this.serializeDeliveryAttempt(row);
  }

  private serializeDeliveryAttempt(
    row: {
      id: string;
      webhookSubscriptionId: string;
      event: string;
      payload: Prisma.JsonValue;
      responseStatus: number | null;
      responseBody: string | null;
      error: string | null;
      attemptedAt: Date;
      succeededAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ): WebhookDeliveryAttemptRow {
    return {
      id: row.id,
      webhookSubscriptionId: row.webhookSubscriptionId,
      event: row.event,
      payload: row.payload as unknown,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      error: row.error,
      attemptedAt: row.attemptedAt.toISOString(),
      succeededAt: row.succeededAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private normalizeEvents(input: string[] | undefined | null): string[] {
    if (!input || input.length === 0) return [...WEBHOOK_EVENT_NAMES];
    const unique = Array.from(new Set(input.map((e) => e.trim()).filter(Boolean)));
    const allowed = new Set<string>([...WEBHOOK_EVENT_NAMES, '*']);
    for (const event of unique) {
      if (!allowed.has(event)) {
        throw new BadRequestException(`WEBHOOK_UNKNOWN_EVENT:${event}`);
      }
    }
    return unique;
  }

  private serialize(row: DbRow, options: { includeSecret: boolean }): WebhookRow {
    const base: WebhookRow = {
      id: row.id,
      url: row.url,
      events: row.events ?? [],
      skillId: row.skillId,
      active: row.active,
      description: row.description ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    if (options.includeSecret) base.secret = row.secret;
    return base;
  }
}
