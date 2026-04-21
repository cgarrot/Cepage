import {
  type InputNodeStartRequest,
  type WorkflowInputAccept,
  type WorkflowInputContent,
} from '@cepage/shared-core';

type InputApiPart = NonNullable<NonNullable<InputNodeStartRequest['input']>['parts']>[number];

export type InputApiDoc = {
  mode: WorkflowInputContent['mode'];
  endpointNodeId: string;
  path: string;
  transport: 'application/json' | 'multipart/form-data';
  accepts: WorkflowInputAccept[];
  multiple: boolean;
  required: boolean;
  fields: string[];
  splitText: boolean;
  payload: string;
  curl: string;
  fetch: string;
};

const ACCEPTS: WorkflowInputAccept[] = ['text', 'image', 'file'];

export function buildInputApiDoc(nodeId: string, input: WorkflowInputContent | null): InputApiDoc | null {
  if (!input) return null;
  const accepts = input.accepts?.length ? [...input.accepts] : [...ACCEPTS];
  const multiple = input.multiple ?? true;
  const required = input.required ?? false;
  const splitText = multiple && accepts.length === 1 && accepts[0] === 'text';
  const transport = accepts.some((kind) => kind !== 'text') ? 'multipart/form-data' : 'application/json';
  const endpointNodeId = input.mode === 'bound' ? input.templateNodeId?.trim() || '<template-node-id>' : nodeId;
  const parts = buildParts(input, accepts, multiple, splitText);
  const fields = parts.flatMap((part) => (part.type === 'text' ? [] : [part.field]));
  const body: InputNodeStartRequest = {
    type: 'opencode',
    role: 'builder',
    workingDirectory: '/workspace/project',
    model: {
      providerID: 'openai',
      modelID: 'gpt-5.4',
    },
    input: { parts },
    sourceNodeIds: ['linked-node-id'],
    newExecution: false,
  };
  const path = `/api/v1/sessions/{sessionId}/inputs/${endpointNodeId}/start`;
  return {
    mode: input.mode,
    endpointNodeId,
    path,
    transport,
    accepts,
    multiple,
    required,
    fields,
    splitText,
    payload: JSON.stringify(body, null, 2),
    curl: transport === 'application/json' ? buildJsonCurl(endpointNodeId, body) : buildMultipartCurl(endpointNodeId, body, parts),
    fetch: transport === 'application/json' ? buildJsonFetch(endpointNodeId, body) : buildMultipartFetch(endpointNodeId, body, parts),
  };
}

function buildParts(
  input: WorkflowInputContent,
  accepts: WorkflowInputAccept[],
  multiple: boolean,
  splitText: boolean,
): InputApiPart[] {
  const kinds = multiple ? accepts : [pickKind(accepts)];
  const slot = slotName(input);
  const root = slug(slot);
  return kinds.map((kind) => {
    if (kind === 'text') {
      return {
        type: 'text',
        text: splitText ? `First ${slot}\nSecond ${slot}` : `Provide the ${slot}.`,
      };
    }
    return {
      type: kind,
      field: fieldName(root, kind),
      transferMode: 'reference',
    };
  });
}

function pickKind(accepts: readonly WorkflowInputAccept[]): WorkflowInputAccept {
  return accepts.find((kind) => kind !== 'text') ?? accepts[0] ?? 'text';
}

function slotName(input: WorkflowInputContent): string {
  const value = input.key?.trim() || input.label?.trim() || 'input';
  return value.replace(/[_-]+/g, ' ').toLowerCase();
}

function slug(value: string): string {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return next.length > 0 ? next : 'input';
}

function fieldName(root: string, kind: Extract<WorkflowInputAccept, 'file' | 'image'>): string {
  return root.endsWith(`_${kind}`) ? root : `${root}_${kind}`;
}

function buildJsonCurl(nodeId: string, body: InputNodeStartRequest): string {
  return [
    'BASE_URL="http://localhost:3100"',
    'SESSION_ID="session-id"',
    '',
    `curl -X POST "$BASE_URL/api/v1/sessions/$SESSION_ID/inputs/${nodeId}/start" \\`,
    "  -H 'Content-Type: application/json' \\",
    `  -d '${JSON.stringify(body)}'`,
  ].join('\n');
}

function buildMultipartCurl(nodeId: string, body: InputNodeStartRequest, parts: readonly InputApiPart[]): string {
  const uploads = parts.filter(isAssetPart);
  const lines = [
    'BASE_URL="http://localhost:3100"',
    'SESSION_ID="session-id"',
    '',
    `curl -X POST "$BASE_URL/api/v1/sessions/$SESSION_ID/inputs/${nodeId}/start" \\`,
    `  -F 'payload=${JSON.stringify(body)}'`,
  ];
  for (const part of uploads) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  -F '${part.field}=@${samplePath(part)}'`);
  }
  return lines.join('\n');
}

function buildJsonFetch(nodeId: string, body: InputNodeStartRequest): string {
  return [
    "const baseUrl = 'http://localhost:3100';",
    "const sessionId = 'session-id';",
    `const payload = ${JSON.stringify(body, null, 2)};`,
    '',
    `await fetch(\`${'${baseUrl}'}/api/v1/sessions/${'${sessionId}'}/inputs/${nodeId}/start\`, {`,
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    '  body: JSON.stringify(payload),',
    '});',
  ].join('\n');
}

function buildMultipartFetch(nodeId: string, body: InputNodeStartRequest, parts: readonly InputApiPart[]): string {
  const uploads = parts.filter(isAssetPart);
  const lines = [
    "const baseUrl = 'http://localhost:3100';",
    "const sessionId = 'session-id';",
    `const payload = ${JSON.stringify(body, null, 2)};`,
    `const uploads = ${JSON.stringify(buildUploadMap(uploads), null, 2)};`,
    'const form = new FormData();',
    "form.append('payload', JSON.stringify(payload));",
  ];
  for (const part of uploads) {
    lines.push(
      `form.append('${part.field}', new File(['demo'], uploads['${part.field}'].name, { type: uploads['${part.field}'].type }));`,
    );
  }
  lines.push(
    '',
    `await fetch(\`${'${baseUrl}'}/api/v1/sessions/${'${sessionId}'}/inputs/${nodeId}/start\`, {`,
    "  method: 'POST',",
    '  body: form,',
    '});',
  );
  return lines.join('\n');
}

function buildUploadMap(parts: ReadonlyArray<Extract<InputApiPart, { type: 'file' | 'image' }>>): Record<string, { name: string; type: string }> {
  return Object.fromEntries(parts.map((part) => [part.field, sampleUpload(part)]));
}

function isAssetPart(part: InputApiPart): part is Extract<InputApiPart, { type: 'file' | 'image' }> {
  return part.type !== 'text';
}

function samplePath(part: Extract<InputApiPart, { type: 'file' | 'image' }>): string {
  return part.type === 'image' ? `/tmp/${part.field}.png` : `/tmp/${part.field}.md`;
}

function sampleUpload(part: Extract<InputApiPart, { type: 'file' | 'image' }>): { name: string; type: string } {
  return part.type === 'image'
    ? { name: `${part.field}.png`, type: 'image/png' }
    : { name: `${part.field}.md`, type: 'text/markdown' };
}
