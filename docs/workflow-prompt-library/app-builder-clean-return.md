# App Builder With Clean Return

## Use This Prompt When

- The user wants a runnable app, feature slice, or prototype.
- The workflow may iterate internally, but the returned workspace should be clean and understandable.
- The user expects a stable final handoff, not just execution traces.

## Prompt Template

```text
Create a workflow that builds <app or feature>.

Intermediate implementation artifacts may be messy during execution.
The final handoff must be clean and match the requested workspace shape.

Requirements:
- Start with a runnable scaffold.
- Iterate on implementation as needed.
- If the workflow depends on user docs or design constraints, persist them onto the graph before implementation begins.
- Add a cleanup/publish phase before final verify so the workspace looks like a human-maintained project, not a pile of run folders.
- If the app is runnable, emit cepage-run.json in the final published shape.
- Final outputs must not live only in tmp folders or run-* scratch folders unless the user explicitly asked for archive-style output.
- Final verify must validate the published files and runtime behavior.
```

## Expected Workflow Shape

1. `agent_phase` scaffold
2. `loop_phase` or repeated `agent_phase` implementation work
3. `agent_phase` cleanup/publish
4. `runtime_verify_phase` runtime or QA verify

## Intermediate Outputs

- Per-run notes
- Scratch implementation outputs
- Temporary manifests or reports

## Published Outputs

- Stable application source tree in the requested location
- Final runtime manifest when the result is runnable
- Handoff notes or README that describe the published app, not only temporary build artifacts

## Validation Expectations

- Final verify should check the stable app files and runtime targets.
- Temporary run folders should not be the only user-facing return unless the user explicitly asked for archived build traces.
- If the publish phase changed the runnable tree, it should refresh the final root `cepage-run.json`.
