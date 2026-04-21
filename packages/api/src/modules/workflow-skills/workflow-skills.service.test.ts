import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { WorkflowSkillsService } from './workflow-skills.service.js';

async function createTempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'workflow-skills-'));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function withRepoFixture<T>(
  setup: (rootDir: string) => Promise<void>,
  run: (rootDir: string) => Promise<T>,
): Promise<T> {
  const previousCwd = process.cwd();
  const previousExtraPaths = process.env.WORKFLOW_SKILLS_EXTRA_PATHS;
  const rootDir = await createTempRepo();
  try {
    await setup(rootDir);
    process.chdir(rootDir);
    delete process.env.WORKFLOW_SKILLS_EXTRA_PATHS;
    return await run(rootDir);
  } finally {
    process.chdir(previousCwd);
    if (previousExtraPaths === undefined) {
      delete process.env.WORKFLOW_SKILLS_EXTRA_PATHS;
    } else {
      process.env.WORKFLOW_SKILLS_EXTRA_PATHS = previousExtraPaths;
    }
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test('workflow skills service loads public catalog without private and routes hello world', async () => {
  await withRepoFixture(
    async (rootDir) => {
      const libraryDir = path.join(rootDir, 'docs', 'workflow-prompt-library');
      await writeJson(path.join(libraryDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'hello-world-workflow',
            kind: 'workflow_template',
            title: 'Hello World Workflow',
            summary: 'Minimal starter workflow.',
            promptFile: 'hello-world-workflow.md',
            tags: ['hello', 'starter'],
            routing: {
              keywords: ['hello world', 'starter workflow'],
              intents: ['hello_world'],
            },
          },
          {
            id: 'workflow-api-operator',
            kind: 'operator_playbook',
            title: 'Workflow API Operator',
            summary: 'Operator playbook.',
            promptFile: 'workflow-copilot-api-skill.md',
            tags: ['operator'],
            routing: { keywords: ['workflow api'], intents: ['workflow_api'] },
          },
        ],
      });
      await writeText(path.join(libraryDir, 'hello-world-workflow.md'), 'public hello prompt\n');
      await writeText(path.join(libraryDir, 'workflow-copilot-api-skill.md'), 'operator prompt\n');
    },
    async () => {
      const svc = new WorkflowSkillsService();
      const catalog = await svc.getCatalog(true);
      assert.equal(catalog.skills.length, 2);
      assert.equal((await svc.routeSkill('create a hello world workflow'))?.id, 'hello-world-workflow');
      const hello = await svc.getSkill('hello-world-workflow');
      assert.equal(await svc.getSkillPrompt(hello), 'public hello prompt\n');
      await assert.rejects(() => svc.getSkill('private-daily-drop'), /WORKFLOW_SKILL_PRIVATE_CATALOG_MISSING:private-daily-drop/);
    },
  );
});

test('workflow skills service merges private catalog and resolves prompts from the correct directory', async () => {
  await withRepoFixture(
    async (rootDir) => {
      const libraryDir = path.join(rootDir, 'docs', 'workflow-prompt-library');
      const privateDir = path.join(libraryDir, 'private');

      await writeJson(path.join(libraryDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'duplicate-skill',
            kind: 'workflow_template',
            title: 'Public Duplicate',
            summary: 'Public version.',
            promptFile: 'duplicate-skill.md',
            tags: ['public'],
            routing: { keywords: ['duplicate public'], intents: ['duplicate_public'] },
          },
          {
            id: 'hello-world-workflow',
            kind: 'workflow_template',
            title: 'Hello World Workflow',
            summary: 'Public hello world.',
            promptFile: 'hello-world-workflow.md',
            tags: ['hello'],
            routing: { keywords: ['hello world'], intents: ['hello_world'] },
          },
        ],
      });
      await writeJson(path.join(privateDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'duplicate-skill',
            kind: 'workflow_template',
            title: 'Private Duplicate',
            summary: 'Private override.',
            promptFile: 'duplicate-skill.md',
            tags: ['private'],
            routing: { keywords: ['duplicate private'], intents: ['duplicate_private'] },
          },
          {
            id: 'private-daily-drop',
            kind: 'workflow_template',
            title: 'Private Daily Drop',
            summary: 'Private skill.',
            promptFile: 'private-daily-drop.md',
            tags: ['private-drop'],
            routing: { keywords: ['private daily drop'], intents: ['private_drop'] },
          },
        ],
      });

      await writeText(path.join(libraryDir, 'duplicate-skill.md'), 'public duplicate prompt\n');
      await writeText(path.join(libraryDir, 'hello-world-workflow.md'), 'public hello prompt\n');
      await writeText(path.join(privateDir, 'duplicate-skill.md'), 'private duplicate prompt\n');
      await writeText(path.join(privateDir, 'private-daily-drop.md'), 'private drop prompt\n');
    },
    async () => {
      const svc = new WorkflowSkillsService();
      const catalog = await svc.getCatalog(true);
      assert.equal(catalog.skills.length, 3);

      const duplicate = await svc.getSkill('duplicate-skill');
      assert.equal(duplicate.title, 'Private Duplicate');
      assert.equal(await svc.getSkillPrompt(duplicate), 'private duplicate prompt\n');

      const hello = await svc.getSkill('hello-world-workflow');
      assert.equal(await svc.getSkillPrompt(hello), 'public hello prompt\n');

      const privateDrop = await svc.getSkill('private-daily-drop');
      assert.equal(await svc.getSkillPrompt(privateDrop), 'private drop prompt\n');
    },
  );
});

test('workflow skills service discovers extra catalogs after private and public ones', async () => {
  await withRepoFixture(
    async (rootDir) => {
      const libraryDir = path.join(rootDir, 'docs', 'workflow-prompt-library');
      const privateDir = path.join(libraryDir, 'private');
      const extraDir = path.join(rootDir, 'extra-catalog');

      await writeJson(path.join(libraryDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'duplicate-skill',
            kind: 'workflow_template',
            title: 'Public Duplicate',
            summary: 'Public version.',
            promptFile: 'duplicate-skill.md',
            tags: ['public'],
            routing: { keywords: ['duplicate public'], intents: ['duplicate_public'] },
          },
        ],
      });
      await writeJson(path.join(privateDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'duplicate-skill',
            kind: 'workflow_template',
            title: 'Private Duplicate',
            summary: 'Private version.',
            promptFile: 'duplicate-skill.md',
            tags: ['private'],
            routing: { keywords: ['duplicate private'], intents: ['duplicate_private'] },
          },
        ],
      });
      await writeJson(path.join(extraDir, 'catalog.json'), {
        schemaVersion: '1',
        skills: [
          {
            id: 'duplicate-skill',
            kind: 'workflow_template',
            title: 'Extra Duplicate',
            summary: 'Extra version.',
            promptFile: 'duplicate-skill.md',
            tags: ['extra'],
            routing: { keywords: ['duplicate extra'], intents: ['duplicate_extra'] },
          },
          {
            id: 'rest-api-pipeline',
            kind: 'workflow_template',
            title: 'REST API Pipeline',
            summary: 'Extra pipeline.',
            promptFile: 'rest-api-pipeline.md',
            tags: ['api'],
            routing: { keywords: ['rest api'], intents: ['rest_api'] },
          },
        ],
      });

      await writeText(path.join(privateDir, 'duplicate-skill.md'), 'private duplicate prompt\n');
      await writeText(path.join(extraDir, 'duplicate-skill.md'), 'extra duplicate prompt\n');
      await writeText(path.join(extraDir, 'rest-api-pipeline.md'), 'extra rest api prompt\n');
    },
    async (rootDir) => {
      process.env.WORKFLOW_SKILLS_EXTRA_PATHS = path.join(rootDir, 'extra-catalog');
      const svc = new WorkflowSkillsService();
      const catalog = await svc.getCatalog(true);

      assert.equal(catalog.skills.length, 2);
      assert.equal((await svc.getSkill('duplicate-skill')).title, 'Private Duplicate');

      const extraSkill = await svc.getSkill('rest-api-pipeline');
      assert.equal(await svc.getSkillPrompt(extraSkill), 'extra rest api prompt\n');
    },
  );
});
