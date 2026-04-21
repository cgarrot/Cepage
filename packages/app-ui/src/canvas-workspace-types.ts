export type MenuMode = 'canvas' | 'edge-drop';

export type SidebarTab = 'activity' | 'chat' | 'content';

export type MenuState = {
  mode: MenuMode;
  x: number;
  y: number;
  flowPosition: { x: number; y: number };
  sourceNodeId: string | null;
};
