import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphNode, GraphSnapshot } from '@cepage/shared-core';
import { SkillAuthoringService } from '../skill-authoring.service.js';
import type { CreateUserSkillDto, UserSkillRow } from '../../user-skills/user-skills.dto.js';

// Fake service doubles. We keep them minimal — we only need the two
// surfaces that SkillAuthoringService actually calls.

function makeGraph(snap: GraphSnapshot) {
  return {
    async loadSnapshot(): Promise<GraphSnapshot> {
      return snap;
    },
  };
}

function makeUserSkills() {
  const created: CreateUserSkillDto[] = [];
  return {
    created,
    async create(input: CreateUserSkillDto): Promise<UserSkillRow> {
      created.push(input);
      return {
        id: 'user-skill-1',
        slug: input.slug ?? 'generated',
        version: '1.0.0',
        title: input.title,
        summary: input.summary,
        icon: input.icon ?? null,
        category: input.category ?? null,
        tags: input.tags ?? [],
        inputsSchema: input.inputsSchema,
        outputsSchema: input.outputsSchema,
        kind: input.kind ?? 'workflow_template',
        promptText: input.promptText ?? null,
        graphJson: input.graphJson ?? null,
        execution: (input.execution as UserSkillRow['execution']) ?? null,
        sourceSessionId: input.sourceSessionId ?? null,
        visibility: input.visibility ?? 'private',
        ownerKey: 'local-user',
        validated: false,
        deprecated: false,
        replacedBySlug: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

function makeNode(
  id: string,
  type: string,
  content: Record<string, unknown>,
): GraphNode {
  return {
    id,
    type: type as GraphNode['type'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: content as GraphNode['content'],
    creator: { type: 'human', userId: 'u1' } as GraphNode['creator'],
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 100 },
    metadata: {},
    status: 'idle' as GraphNode['status'],
    branches: [],
  };
}

function makeSnap(nodes: GraphNode[]): GraphSnapshot {
  return {
    version: 1,
    id: 'test-session' as GraphSnapshot['id'],
    createdAt: new Date().toISOString(),
    nodes,
    edges: [],
    branches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test('detectInputs returns an empty schema when no placeholders exist', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'do something generic without variables' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  assert.equal(detection.detected.length, 0);
  assert.deepEqual(detection.inputsSchema.properties, {});
  assert.equal(detection.inputsSchema.additionalProperties, false);
});

test('detectInputs de-duplicates placeholders and counts occurrences', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', {
      text: 'Research {{TOPIC}} for {{AUDIENCE}} and score {{TOPIC}}.',
    }),
    makeNode('n2', 'control', { instructions: 'Summarize {{AUDIENCE}}.' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const byName = Object.fromEntries(detection.detected.map((d) => [d.name, d]));
  assert.equal(detection.detected.length, 2);
  assert.equal(byName.TOPIC.occurrences, 2);
  assert.equal(byName.AUDIENCE.occurrences, 2);
  assert.deepEqual(
    (detection.inputsSchema.required ?? []).slice().sort(),
    ['AUDIENCE', 'TOPIC'],
  );
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.TOPIC?.type, 'string');
  assert.equal(props.AUDIENCE?.type, 'string');
});

test('detectInputs uses control/agent text for promptText, excludes other nodes', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { prompt: 'Step one {{X}}' }),
    makeNode('n2', 'control', { instructions: 'Always succeed for {{X}}' }),
    makeNode('n3', 'workflow_input', { text: 'this is an input hint only' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  assert.ok(detection.promptText);
  assert.match(detection.promptText ?? '', /Step one/);
  assert.match(detection.promptText ?? '', /Always succeed/);
  assert.doesNotMatch(detection.promptText ?? '', /this is an input hint only/);
});

test('saveAsSkill persists a UserSkill with detection + overrides', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Research {{TOPIC}} thoroughly.' }),
  ]);
  const users = makeUserSkills();
  const svc = new SkillAuthoringService(makeGraph(snap) as never, users as never);
  const row = await svc.saveAsSkill('test-session', {
    title: 'Research runner',
    summary: 'Runs a research pipeline on any topic.',
    tags: ['research'],
  });
  assert.equal(users.created.length, 1);
  const input = users.created[0];
  assert.equal(input.slug, 'research-runner');
  assert.equal(input.kind, 'workflow_template');
  assert.equal(input.sourceSessionId, 'test-session');
  assert.equal(input.visibility, 'private');
  assert.ok(input.inputsSchema);
  assert.ok(input.outputsSchema);
  const props = input.inputsSchema.properties as Record<string, unknown> | undefined;
  assert.ok(props && 'TOPIC' in props);
  assert.equal(row.slug, 'research-runner');
});

test('saveAsSkill respects explicit slug and schema overrides', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Do {{ALPHA}}' }),
  ]);
  const users = makeUserSkills();
  const svc = new SkillAuthoringService(makeGraph(snap) as never, users as never);
  const customSchema = {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  };
  await svc.saveAsSkill('test-session', {
    title: 'Custom Flow',
    summary: 'custom flow',
    slug: 'special-slug',
    inputsSchema: customSchema,
    outputsSchema: { type: 'object' },
    visibility: 'workspace',
  });
  const input = users.created[0];
  assert.equal(input.slug, 'special-slug');
  assert.equal(input.visibility, 'workspace');
  assert.deepEqual(input.inputsSchema, customSchema);
});

test('detectInputs infers date type from name containing date', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Report from {{startDate}} to {{endDate}}' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.startDate?.type, 'string');
  assert.equal(props.startDate?.format, 'date');
  assert.equal(props.endDate?.type, 'string');
  assert.equal(props.endDate?.format, 'date');
  const byName = Object.fromEntries(detection.detected.map((d) => [d.name, d]));
  assert.equal(byName.startDate.inferredType, 'string');
  assert.equal(byName.endDate.inferredType, 'string');
});

test('detectInputs infers password format and writeOnly for secrets', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', {
      text: 'Connect with {{stripeApiKey}} using {{password}} and {{AUTH_TOKEN}}',
    }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.stripeApiKey?.type, 'string');
  assert.equal(props.stripeApiKey?.format, 'password');
  assert.equal(props.stripeApiKey?.writeOnly, true);
  assert.equal(props.password?.type, 'string');
  assert.equal(props.password?.format, 'password');
  assert.equal(props.password?.writeOnly, true);
  assert.equal(props.AUTH_TOKEN?.type, 'string');
  assert.equal(props.AUTH_TOKEN?.format, 'password');
  assert.equal(props.AUTH_TOKEN?.writeOnly, true);
});

test('detectInputs infers array type from plural names or list keyword', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Process {{segments}} and {{emailList}}' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.segments?.type, 'array');
  assert.deepEqual(props.segments?.items, { type: 'string' });
  assert.equal(props.emailList?.type, 'array');
  assert.deepEqual(props.emailList?.items, { type: 'string' });
});

test('detectInputs infers boolean type from is/has/include/enable prefix', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', {
      text: 'Check {{isActive}}, {{hasAccess}}, {{includeRefunds}}, {{enableNotifications}}',
    }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.isActive?.type, 'boolean');
  assert.equal(props.hasAccess?.type, 'boolean');
  assert.equal(props.includeRefunds?.type, 'boolean');
  assert.equal(props.enableNotifications?.type, 'boolean');
});

test('detectInputs infers uri format for url or endpoint names', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Call {{webhookUrl}} and {{apiEndpoint}}' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.webhookUrl?.type, 'string');
  assert.equal(props.webhookUrl?.format, 'uri');
  assert.equal(props.apiEndpoint?.type, 'string');
  assert.equal(props.apiEndpoint?.format, 'uri');
});

test('detectInputs defaults to string when no heuristic matches', async () => {
  const snap = makeSnap([
    makeNode('n1', 'agent_step', { text: 'Hello {{name}} from {{city}}' }),
  ]);
  const svc = new SkillAuthoringService(
    makeGraph(snap) as never,
    makeUserSkills() as never,
  );
  const detection = await svc.detectInputs('test-session');
  const props = detection.inputsSchema.properties ?? {};
  assert.equal(props.name?.type, 'string');
  assert.equal(props.name?.format, undefined);
  assert.equal(props.city?.type, 'string');
  assert.equal(props.city?.format, undefined);
});
