export const DEFAULT_NODE_WIDTH = 280;
export const DEFAULT_SIDEBAR_WIDTH = 360;
export const COLLAPSED_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 720;
export const MIN_CANVAS_WIDTH = 240;

export function getClientPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY };
  }

  const touch = event.changedTouches[0] ?? event.touches[0];
  if (!touch) return null;
  return { x: touch.clientX, y: touch.clientY };
}

export function isPaneTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.react-flow__pane') !== null;
}

export function centerNodePosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(24, position.x - DEFAULT_NODE_WIDTH / 2),
    y: Math.max(24, position.y - 24),
  };
}

export function clampSidebarWidth(width: number): number {
  if (typeof window === 'undefined') {
    return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
  }

  const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH));
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), max);
}
