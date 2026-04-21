type Translate = (key: string, params?: Record<string, string | number>) => string;

export function buildRestoreCheckpointConfirm(t: Translate, checkpointId: string): string {
  return t('ui.sidebar.copilotRestoreConfirm', {
    id: checkpointId.slice(0, 8),
  });
}
