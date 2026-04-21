import { apiGet } from './http';

export type DaemonStatusRuntime = {
  id: string;
  lastSeenAt: string;
  host: string | null;
  name?: string;
  version?: string;
  supportedAgents?: string[];
};

export type DaemonStatus = {
  online: boolean;
  count: number;
  lastSeenAt: string | null;
  runtimes: DaemonStatusRuntime[];
};

/**
 * Returns the live status of native daemons polling the API. The UI uses this
 * to surface a "daemon offline" warning when no `cepage-daemon` is connected,
 * because agent runs and runtime processes are dispatched exclusively through
 * the daemon.
 */
export async function getDaemonStatus() {
  return apiGet<DaemonStatus>('/api/v1/execution/daemon/status');
}
