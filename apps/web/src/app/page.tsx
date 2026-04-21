'use client';

import { WorkspaceShell } from '@cepage/app-ui';
import { useWorkspaceStore } from '@cepage/state';
import { useEffect } from 'react';

export default function HomePage() {
  const load = useWorkspaceStore((s) => s.loadSession);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('session');
    if (id) void load(id);
  }, [load]);

  return <WorkspaceShell />;
}
