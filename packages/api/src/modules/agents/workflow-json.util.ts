export function parseWorkflowJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function readWorkflowJsonPath(root: unknown, value: string): unknown {
  const clean = value.trim().replace(/\[(\d+)\]/g, '.$1');
  if (!clean) {
    return undefined;
  }
  let current = root;
  for (const part of clean.split('.').filter(Boolean)) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function hasWorkflowJsonPath(root: unknown, value: string): boolean {
  return readWorkflowJsonPath(root, value) !== undefined;
}

export function hasWorkflowJsonPathNonempty(root: unknown, value: string): boolean {
  const current = readWorkflowJsonPath(root, value);
  if (current == null) {
    return false;
  }
  if (typeof current === 'string') {
    return current.trim().length > 0;
  }
  if (Array.isArray(current)) {
    return current.length > 0;
  }
  if (typeof current === 'object') {
    return Object.keys(current as Record<string, unknown>).length > 0;
  }
  return true;
}

export function hasWorkflowJsonPathArrayNonempty(root: unknown, value: string): boolean {
  const current = readWorkflowJsonPath(root, value);
  return Array.isArray(current) && current.length > 0;
}
