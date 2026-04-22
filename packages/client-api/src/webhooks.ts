import { apiDelete, apiGet, apiPatch, apiPost } from './http';

export type WebhookEventName =
  | 'skill-run.started'
  | 'skill-run.succeeded'
  | 'skill-run.failed'
  | 'skill-run.cancelled'
  | 'skill-run.progress'
  | 'webhook.ping'
  | '*';

export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  skillId: string | null;
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  secret?: string;
};

export type CreateWebhookBody = {
  url: string;
  events?: string[];
  skillId?: string | null;
  active?: boolean;
  description?: string;
};

export type UpdateWebhookBody = {
  url?: string;
  events?: string[];
  skillId?: string | null;
  active?: boolean;
  description?: string | null;
  secretAction?: 'rotate' | 'keep';
};

export async function listWebhooks() {
  return apiGet<{ items: WebhookRow[] }>('/api/v1/webhooks');
}

export async function createWebhook(body: CreateWebhookBody) {
  return apiPost<WebhookRow>('/api/v1/webhooks', body);
}

export async function getWebhook(id: string) {
  return apiGet<WebhookRow>(`/api/v1/webhooks/${id}`);
}

export async function updateWebhook(id: string, body: UpdateWebhookBody) {
  return apiPatch<WebhookRow>(`/api/v1/webhooks/${id}`, body);
}

export async function deleteWebhook(id: string) {
  return apiDelete<{ deleted: true }>(`/api/v1/webhooks/${id}`);
}
