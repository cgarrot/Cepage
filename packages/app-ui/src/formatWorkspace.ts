import type { Translator } from '@cepage/i18n';
import type { ActivityLine, StatusDescriptor } from '@cepage/state';

export function formatStatusLine(status: StatusDescriptor | null, t: Translator): string {
  if (!status) return '';
  if (status.key === 'status.run' && typeof status.params?.status === 'string') {
    const phase = status.params.status;
    return t('status.run', {
      status: t(`agentRunStatus.${phase}`),
    });
  }
  const out = t(status.key, status.params ?? {});
  if (out === status.key && status.fallback) return status.fallback;
  return out;
}

export function formatActivityLine(line: ActivityLine, t: Translator): string {
  if (line.summaryKey) {
    const out = t(line.summaryKey, line.summaryParams ?? {});
    if (out !== line.summaryKey) return out;
  }
  return line.summary;
}
