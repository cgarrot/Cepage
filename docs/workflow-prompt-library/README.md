# Workflow Prompt Library

This directory documents prompt patterns that `workflow-copilot` should handle well, plus the workflow shape each prompt is expected to generate.

## Public vs Private catalogs

- `catalog.json` is the public catalog committed with the repository.
- `private/catalog.json` is optional and local-only for personal or sensitive skills.
- `local/` is also ignored for local experiments.
- `WORKFLOW_SKILLS_EXTRA_PATHS` can point to extra absolute catalog paths or directories that contain `catalog.json`.

The API merges catalogs with this precedence:

1. `private/`
2. public root catalog
3. extra catalogs from `WORKFLOW_SKILLS_EXTRA_PATHS`

Prompt files are resolved relative to the catalog that declared the skill.

## Core Rule

- Intermediate execution artifacts can be messy, per-run, or temporary.
- If the user asks for a final return, handoff, deliverable pack, or exported artifact tree, the generated workflow should include a cleanup/publish phase.
- The cleanup/publish phase is responsible for turning intermediate artifacts into stable user-facing outputs that match the requested filenames, folders, and overall shape.
- Final verification should validate the published outputs, not only the intermediate run artifacts.

## Available Public Prompt Patterns

| Prompt | Use when | Expected workflow shape |
|--------|----------|-------------------------|
| [`documentation-pack-clean-return.md`](documentation-pack-clean-return.md) | The user wants a multi-file documentation pack, research pack, or reusable context bundle. | `research -> scaffold -> derive_input -> loop(per_run) -> cleanup/publish -> runtime_verify` |
| [`three-js-vanilla-clean-return.md`](three-js-vanilla-clean-return.md) | The user wants the validated `Three.js` vanilla documentation-pack variant with stable final docs and no `React Three Fiber`. | `research -> scaffold -> derive_input -> loop(per_run) -> cleanup/publish -> runtime_verify` |
| [`app-builder-clean-return.md`](app-builder-clean-return.md) | The user wants a runnable app or feature build plus a clean final workspace handoff. | `scaffold -> implementation loop -> cleanup/publish -> runtime/polish verify` |
| [`game-dev-managed-flow-clean-return.md`](game-dev-managed-flow-clean-return.md) | The user wants a reusable game-development workflow driven by source docs, visible review loops, and stable published outputs. | `persist docs -> analyze -> roadmap -> derive_input -> loop(review/refine/test) -> cleanup/publish -> runtime_verify` |
| [`analysis-pipeline-modular-architect.md`](analysis-pipeline-modular-architect.md) | The user wants a modular analysis and research pipeline. | `analyze -> research -> synthesize -> generate -> runtime_verify` |
| [`workflow-generator-publish.md`](workflow-generator-publish.md) | The user wants a workflow that generates another workflow or workflow artifact for reuse. | `assemble -> lint -> publish -> verify` |
| [`hello-world-workflow.md`](hello-world-workflow.md) | The user wants a minimal starter workflow. | `generate -> runtime_verify` |
| [`rest-api-pipeline.md`](rest-api-pipeline.md) | The user wants a generic REST integration flow. | `fetch -> transform -> publish -> runtime_verify` |
| [`scheduled-report-generator.md`](scheduled-report-generator.md) | The user wants a recurring report workflow. | `collect -> summarize -> publish -> runtime_verify` |
| [`file-organizer.md`](file-organizer.md) | The user wants to classify and organize files. | `inventory -> classify -> publish -> runtime_verify` |
| [`notification-dispatcher.md`](notification-dispatcher.md) | The user wants one message adapted across multiple channels. | `prepare -> adapt_per_channel -> publish -> runtime_verify` |

## Catalogs

- Public machine-readable summary: [`catalog.json`](catalog.json)
- Private local-only summary: `private/catalog.json` (gitignored, optional)

## How to add skills

### Add a public skill

1. Add the prompt markdown file in this directory.
2. Register the skill in the root `catalog.json`.
3. Add or update public real-tester scenarios in `scripts/workflow-real-tester-scenarios.mjs`.

### Add a personal skill

1. Create `docs/workflow-prompt-library/private/` locally if it does not exist.
2. Put the prompt markdown file in `private/`.
3. Register the skill in `private/catalog.json` with `promptFile` relative to `private/`.
4. Optionally add local-only QA coverage in `private/e2e-scenarios.mjs`.

### Add an extra external catalog

Set `WORKFLOW_SKILLS_EXTRA_PATHS` to a comma-separated list of absolute paths. Each entry can be:

- an absolute path to a `catalog.json` file, or
- an absolute path to a directory containing `catalog.json`

## Operator Docs

- [`workflow-copilot-api-skill.md`](workflow-copilot-api-skill.md) is the operator playbook for using the API across `workflow-copilot`, direct workflow runs, input starts, controller runs, runtime targets, approvals, monitoring, and final artifact validation.
- Project skill: `.cursor/skills/workflow-api-operator/SKILL.md`

## Notes

- Keep `run-*` outputs only as provenance or intermediate execution artifacts unless the user explicitly asked for archival layout.
- Prefer stable published files in `README`, indexes, manifests, and handoff notes.
- If the user requests one file per topic, one file per slug, or a specific directory tree, the cleanup/publish phase should materialize that exact shape before final verify.
- For workflows driven by user documents, persist those source-of-truth docs onto the graph before implementation phases consume them.
- For runnable projects, keep the publish contract responsible for refreshing the final root `cepage-run.json`.
- Keep at least one validated concrete example in the library for high-value patterns, not only generic templates.
- For image-heavy workflows, split cheap file enumeration from visual analysis and prefer per-image loops over a single directory-wide multimodal step.
- When loop outputs are written per run, publish and verify should aggregate from the full `run-*` artifact set, not only the template output path.
- For catalog workflows that infer identity or materials, prefer explicit confidence thresholds and use `X` for unknown fields instead of guessed values.
