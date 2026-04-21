'use client';

import { useEffect, useRef, useState } from 'react';
import { getDaemonStatus, type DaemonStatus } from '@cepage/client-api';

const DEFAULT_INTERVAL_MS = 5_000;

export type DaemonStatusState = {
  /**
   * Last known daemon status. `null` means we have never received a successful
   * response yet (initial render or hard error before the first poll
   * completed).
   */
  status: DaemonStatus | null;
  /** True while the very first poll is in flight (covers the initial render). */
  loading: boolean;
  /** Last poll error, if any. Cleared when the next poll succeeds. */
  error: string | null;
};

/**
 * Poll the API for native-daemon connectivity. Used by the chat header to
 * surface a "daemon offline" warning, since agent runs and runtime processes
 * are dispatched exclusively through `cepage-daemon`.
 *
 * Tab visibility is honored: when the tab is hidden, the timer is paused and
 * resumed (with an immediate poll) on the next focus event.
 */
export function useDaemonStatus(intervalMs: number = DEFAULT_INTERVAL_MS): DaemonStatusState {
  const [state, setState] = useState<DaemonStatusState>({
    status: null,
    loading: true,
    error: null,
  });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const result = await getDaemonStatus();
        if (!aliveRef.current) return;
        if (result.success) {
          setState({ status: result.data, loading: false, error: null });
        } else {
          setState((prev) => ({
            status: prev.status,
            loading: false,
            error: result.error?.message ?? 'unknown_error',
          }));
        }
      } catch (err) {
        if (!aliveRef.current) return;
        setState((prev) => ({
          status: prev.status,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        if (aliveRef.current && document.visibilityState !== 'hidden') {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    const onVisibility = () => {
      if (!aliveRef.current) return;
      if (document.visibilityState === 'hidden') {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (!timer) {
        void tick();
      }
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return state;
}
