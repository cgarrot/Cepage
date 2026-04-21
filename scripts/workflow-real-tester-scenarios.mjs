import { existsSync } from 'node:fs';
import path from 'node:path';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W1XQAAAAASUVORK5CYII=';
const ARTISTIC_DIRECTION_OVERRIDE_PATH = (process.env.WORKFLOW_TESTER_ARTISTIC_DIRECTION_PATH ?? '').trim();

export function text(pathname, content, summary) {
  return {
    path: pathname,
    kind: 'text',
    content: content.trim() + '\n',
    summary,
  };
}

export function png(pathname, summary) {
  return {
    path: pathname,
    kind: 'base64',
    content: PNG_1X1,
    summary,
  };
}

export function copyFile(pathname, sourcePath, summary) {
  return {
    path: pathname,
    kind: 'copy_file',
    sourcePath,
    summary,
  };
}

export function copyDir(pathname, sourcePath, summary) {
  return {
    path: pathname,
    kind: 'copy_dir',
    sourcePath,
    summary,
  };
}

export function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, '')}${suffix}`;
}

export function contains(pathname, needle) {
  return {
    kind: 'text_includes',
    path: pathname,
    needle,
  };
}

export function json(pathname) {
  return {
    kind: 'json_parse',
    path: pathname,
  };
}

function resolveOptionalScenarioPath(workflowLibraryRoot, rawPath) {
  const value = rawPath.trim();
  if (!value) {
    return null;
  }
  return path.isAbsolute(value)
    ? value
    : path.resolve(workflowLibraryRoot, value);
}

export function artisticDirectionFile(workflowLibraryRoot) {
  const overridePath = resolveOptionalScenarioPath(workflowLibraryRoot, ARTISTIC_DIRECTION_OVERRIDE_PATH);
  if (!overridePath) {
    return text(
      'inputs/artistic-direction.md',
      `
      Artistic direction:
      - write in French or franglais cadence
      - dark, tense, focused
      - turn technical pressure into proof and momentum
      - avoid generic motivational rap language
      - prefer precise imagery, recurring motifs, and a hook that feels inevitable
      `,
      'Creative direction for the final track.',
    );
  }
  if (!existsSync(overridePath)) {
    throw new Error(`WORKFLOW_TESTER_ARTISTIC_DIRECTION_PATH not found: ${overridePath}`);
  }
  return copyFile(
    'inputs/artistic-direction.md',
    overridePath,
    `Creative direction copied from ${overridePath}.`,
  );
}

export const REAL_WORKFLOW_TEST_SCENARIOS = {
  'documentation-pack-clean-return': {
    prompt: ({ files }) => [
      'Use the pinned workflow to create a stable documentation pack.',
      'Goal: turn the fixture source notes into a reusable context pack about workflow validation and deterministic graph building.',
      'Use the workspace files below as the source material.',
      files,
      'Publish stable outputs only.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/topic.md',
        `
        Topic: Deterministic workflow validation

        Focus on:
        - why free-form graph generation breaks
        - why modular workflows reduce failure modes
        - why validation must check outputs, not only topology
        `,
        'Short topic brief for the documentation pack.',
      ),
      text(
        'inputs/source-notes.md',
        `
        Notes:
        - A workflow can look structurally correct and still fail at runtime.
        - A builder should own critical wiring.
        - Stable published outputs matter more than temporary run files.
        - Final verification should be explicit and visible.
        `,
        'Source notes about workflow validation.',
      ),
    ],
    expectedOutputs: ['docs/index.md', 'outputs/verify.txt'],
    checks: [
      contains('docs/index.md', 'workflow'),
      contains('outputs/verify.txt', 'verify'),
    ],
  },
  'three-js-vanilla-clean-return': {
    prompt: ({ files }) => [
      'Use the pinned workflow to create a Three.js vanilla context pack for game-development work.',
      'Use the workspace files below as the source material.',
      files,
      'Publish stable framework documentation and a verify marker.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/framework-brief.md',
        `
        Three.js vanilla context goals:
        - scene setup
        - camera and renderer lifecycle
        - sprite-heavy 2D/2.5D patterns
        - performance constraints for browser games
        `,
        'Three.js vanilla framework brief.',
      ),
      text(
        'inputs/framework-questions.md',
        `
        Questions to cover:
        - when to use OrthographicCamera
        - how to structure render loops
        - how to keep docs practical for fast iteration
        `,
        'Framework questions for the documentation pack.',
      ),
    ],
    expectedOutputs: ['docs/context/frameworks/README.md', 'outputs/verify.txt'],
    checks: [
      contains('docs/context/frameworks/README.md', 'Three.js'),
      contains('outputs/verify.txt', 'verify'),
    ],
  },
  'app-builder-clean-return': {
    prompt: ({ files }) => [
      'Use the pinned workflow to plan and build a small real app slice.',
      'Goal: create a lightweight review assistant for workflow runs.',
      'Use the workspace files below as the source material.',
      files,
      'Produce a real handoff and runnable implementation notes.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/product-brief.md',
        `
        Product brief:
        Build a tiny internal app that lists workflow runs, shows pass or fail, and highlights missing output files.
        `,
        'App product brief.',
      ),
      text(
        'inputs/constraints.md',
        `
        Constraints:
        - keep the UI simple
        - focus on pass or fail visibility
        - prefer deterministic validation over flashy design
        `,
        'App implementation constraints.',
      ),
    ],
    expectedOutputs: ['outputs/handoff-notes.md'],
    checks: [contains('outputs/handoff-notes.md', 'workflow')],
  },
  'game-dev-managed-flow-clean-return': {
    timeoutMs: 420000,
    prompt: ({ files }) => [
      'Use the pinned workflow to build a modular game-dev cycle for a Vampire Survivors style game.',
      'Use the workspace files below as the source material.',
      files,
      'Create analysis, roadmap, and final review outputs.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/game-analysis.md',
        `
        Gameplay analysis:
        - the strongest moments come from readable enemy pressure
        - power progression feels good when upgrades create visible build identity
        - the weak area is long-term meta progression
        `,
        'Gameplay analysis for the game-dev workflow.',
      ),
      text(
        'inputs/game-research-goals.md',
        `
        Research goals:
        - improve long-term progression
        - keep short-session fun
        - avoid overcomplicating the first ten minutes
        `,
        'Research goals for the game-dev workflow.',
      ),
    ],
    expectedOutputs: ['outputs/analysis.md', 'outputs/roadmap.md', 'outputs/final-review.md'],
    checks: [
      contains('outputs/analysis.md', 'progression'),
      contains('outputs/roadmap.md', 'roadmap'),
      contains('outputs/final-review.md', 'review'),
    ],
  },
  'analysis-pipeline-modular-architect': {
    prompt: ({ files }) => [
      'Use the pinned workflow to turn existing analysis data into deeper research and new generated outputs.',
      'Use the workspace files below as the source material.',
      files,
      'The final outputs should include a report and a structured manifest.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/analysis.json',
        JSON.stringify(
          {
            theme: 'workflow reliability',
            signals: [
              'missing links between nodes',
              'weak routing under ambiguous prompts',
              'runtime failures despite valid graph shape',
            ],
          },
          null,
          2,
        ),
        'Structured analysis data for the modular pipeline.',
      ),
      text(
        'inputs/research-goals.md',
        `
        Deepen these areas:
        - semantic validation
        - modular decomposition
        - pass or fail run validation
        `,
        'Research goals for the modular analysis workflow.',
      ),
    ],
    expectedOutputs: ['outputs/final-report.md', 'outputs/final-manifest.json'],
    checks: [
      contains('outputs/final-report.md', 'validation'),
      json('outputs/final-manifest.json'),
    ],
  },
  'workflow-generator-publish': {
    prompt: ({ files }) => [
      'Use the pinned workflow to generate and publish a reusable workflow artifact.',
      'Use the workspace files below as the source material.',
      files,
      'The final output must be a valid workflow-transfer JSON artifact.',
    ].join('\n\n'),
    files: [
      text(
        'inputs/workflow-goal.md',
        `
        Build a reusable workflow template for modular analysis, synthesis, and final validation.
        `,
        'Workflow goal brief.',
      ),
      text(
        'inputs/workflow-constraints.md',
        `
        Constraints:
        - deterministic outputs
        - explicit validation
        - modular phases
        `,
        'Workflow artifact constraints.',
      ),
    ],
    expectedOutputs: ['workflow-transfer.json'],
    checks: [json('workflow-transfer.json')],
  },
  'hello-world-workflow': {
    prompt: ({ files }) => ['Use the pinned workflow to create the smallest hello world example.', files].join('\n\n'),
    files: [text('inputs/goal.md', 'Create a minimal hello world workflow artifact.', 'Minimal hello world request.')],
    expectedOutputs: ['outputs/hello-world.txt', 'outputs/verify.txt'],
    checks: [contains('outputs/hello-world.txt', 'hello'), contains('outputs/verify.txt', 'verify')],
  },
  'rest-api-pipeline': {
    prompt: ({ files }) => ['Use the pinned workflow to model a reusable REST API integration pipeline.', files].join('\n\n'),
    files: [
      text('inputs/api-brief.md', 'Normalize multiple API responses into one stable result payload.', 'REST API brief.'),
      text('inputs/output-contract.md', 'Publish one final outputs/result.json file and a verify marker.', 'Requested output contract.'),
    ],
    expectedOutputs: ['outputs/result.json', 'outputs/verify.txt'],
    checks: [json('outputs/result.json'), contains('outputs/verify.txt', 'verify')],
  },
  'scheduled-report-generator': {
    prompt: ({ files }) => ['Use the pinned workflow to build a weekly reporting flow.', files].join('\n\n'),
    files: [
      text('inputs/report-scope.md', 'Generate a weekly summary of workflow reliability metrics.', 'Report scope.'),
      text('inputs/data-sources.md', 'Use incident counts, failed runs, and unresolved blockers as the input sources.', 'Report data sources.'),
    ],
    expectedOutputs: ['outputs/report.md', 'outputs/report.json', 'outputs/verify.txt'],
    checks: [contains('outputs/report.md', 'report'), json('outputs/report.json'), contains('outputs/verify.txt', 'verify')],
  },
  'file-organizer': {
    prompt: ({ files }) => ['Use the pinned workflow to organize a messy folder into a stable manifest and summary.', files].join('\n\n'),
    files: [
      text('inputs/rules.md', 'Group files by type and urgency, then publish a plan.', 'Organization rules.'),
      text('inputs/input-directory-note.md', 'Assume the input directory contains screenshots, notes, and JSON exports.', 'Directory note.'),
    ],
    expectedOutputs: ['outputs/file-plan.json', 'outputs/file-summary.md', 'outputs/verify.txt'],
    checks: [json('outputs/file-plan.json'), contains('outputs/file-summary.md', 'file'), contains('outputs/verify.txt', 'verify')],
  },
  'notification-dispatcher': {
    prompt: ({ files }) => ['Use the pinned workflow to prepare notifications for email, chat, and SMS.', files].join('\n\n'),
    files: [
      text('inputs/message-brief.md', 'Dispatch a maintenance alert across multiple channels.', 'Message brief.'),
      text('inputs/channels.md', 'Channels: email, chat, sms.', 'Requested channels.'),
    ],
    expectedOutputs: ['outputs/dispatch-plan.json', 'outputs/dispatch-summary.md', 'outputs/verify.txt'],
    checks: [json('outputs/dispatch-plan.json'), contains('outputs/dispatch-summary.md', 'dispatch'), contains('outputs/verify.txt', 'verify')],
  },
};

export function summarizeScenarioFiles(files) {
  return files.map((file) => `- ${file.path}: ${file.summary}`).join('\n');
}
