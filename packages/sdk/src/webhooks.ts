import type { HttpTransport } from './http.js';
import type {
  CreateWebhookBody,
  UpdateWebhookBody,
  Webhook,
  WebhookPingResult,
  WebhookWithSecret,
} from './types.js';

// Typed wrapper for `/webhooks`. The server returns the plaintext
// `secret` exactly once on `create` and `rotateSecret`; regular
// `list`/`get`/`update` calls return Webhook (no secret field).
//
// Consumers should persist the secret immediately after create; the
// server intentionally re-generates it on rotation and never stores
// the plaintext beyond the row itself. That matches Stripe-style key
// rotation semantics and keeps the audit trail simple.

export class WebhooksResource {
  constructor(private readonly http: HttpTransport) {}

  async list(): Promise<Webhook[]> {
    const result = await this.http.request<Webhook[] | { items?: Webhook[] }>(
      'GET',
      '/webhooks',
    );
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.items) ? result.items : [];
  }

  async get(id: string): Promise<Webhook> {
    return this.http.request<Webhook>('GET', `/webhooks/${encodeURIComponent(id)}`);
  }

  async create(body: CreateWebhookBody): Promise<WebhookWithSecret> {
    return this.http.request<WebhookWithSecret>('POST', '/webhooks', { body });
  }

  async update(id: string, body: UpdateWebhookBody): Promise<WebhookWithSecret | Webhook> {
    return this.http.request<WebhookWithSecret | Webhook>(
      'PATCH',
      `/webhooks/${encodeURIComponent(id)}`,
      { body },
    );
  }

  async delete(id: string): Promise<void> {
    await this.http.request('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }

  async ping(id: string): Promise<WebhookPingResult> {
    return this.http.request<WebhookPingResult>(
      'POST',
      `/webhooks/${encodeURIComponent(id)}/ping`,
    );
  }

  async rotateSecret(id: string): Promise<WebhookWithSecret> {
    return this.http.request<WebhookWithSecret>(
      'POST',
      `/webhooks/${encodeURIComponent(id)}/rotate-secret`,
    );
  }
}
