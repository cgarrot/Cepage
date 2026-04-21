import type { GraphNode } from '@cepage/shared-core';

export type StructuredNodeEditorProps = {
  raw: GraphNode;
  onPatch: (content: GraphNode['content']) => void;
};
