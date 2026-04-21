# Game Dev Managed Flow With Clean Return

## Use This Prompt When

- The user wants a multi-step game-development workflow, not just a one-shot scaffold.
- The workflow must analyze design constraints, plan slices, iterate on implementation, review each slice, and publish a clean final project.
- The user expects the generated workflow to be inspectable on the canvas and reusable later.

## Prompt Template

```text
Create a workflow that builds <game or interactive app> from source-of-truth design docs and technical framework docs.

The workflow must be a connected managed_flow, not a loose set of notes.
Intermediate execution artifacts may be per-run, but the final handoff must publish stable files in the requested workspace layout.

Requirements:
- Persist every user-provided source-of-truth document into the workflow graph as file_summary or workspace_file context before implementation begins.
- Add explicit analyze, roadmap, slice-manifest, agent-prompt, dev-loop, publish, and final verify phases.
- The dev loop must expose an inspectable builder -> reviewer -> integrator/refine -> tester shape instead of hiding review/refine in prose.
- Stable outputs must be written to exact workspace-relative paths such as:
  - outputs/analysis.md
  - outputs/roadmap.md
  - outputs/slices.json
  - outputs/agent-prompts/<slice>.md
  - outputs/reviews/<slice>.md
  - outputs/final-review.md
  - outputs/verify.txt
- Final outputs must not live only in tmp folders, run-* folders, or process temp directories.
- If the project is runnable, publish cepage-run.json at the workspace root in the final integrated tree.
- Final verify must validate both the published files and the runtime manifest.
```

## Expected Workflow Shape

1. `agent_phase` analyze
2. `agent_phase` roadmap
3. `agent_phase` slice manifest
4. `derive_input_phase` slices -> template input
5. `loop_phase` slice implementation loop
6. loop body `sub_graph` with visible builder, reviewer, integrator/refine, and tester steps
7. `agent_phase` cleanup/publish
8. `runtime_verify_phase` final verify

## Intermediate Outputs

- Per-run implementation drafts
- Gap reports or review manifests
- Temporary slice work products

## Published Outputs

- Stable analysis, roadmap, prompt, and review files in requested workspace-relative locations
- Clean final project tree
- Root `cepage-run.json` when the result is runnable
- `outputs/verify.txt` ending with `VERIFY_OK`

## Validation Expectations

- The managed flow should connect every executable and validation node through structured refs and materialized edges.
- Source-of-truth docs should be persisted onto the graph and linked to the phases that consume them.
- Final verify should check stable published outputs, not only per-run artifacts.
- The final handoff should be inspectable without opening tmp or run-* folders.
