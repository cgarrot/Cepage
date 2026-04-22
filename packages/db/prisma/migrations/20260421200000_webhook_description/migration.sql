-- Add an optional free-text description column so webhook subscriptions
-- can carry human-readable labels (e.g. "prod Slack relay" vs
-- "staging digest"). The column is nullable so existing rows stay valid.
ALTER TABLE "WebhookSubscription" ADD COLUMN "description" TEXT;
