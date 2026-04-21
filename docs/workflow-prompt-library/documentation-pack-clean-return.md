# Documentation Pack With Clean Return

## Use This Prompt When

- The user wants a reusable documentation pack, research pack, or context bundle.
- The user cares about the final artifact tree that will be handed back.
- The workflow may need loops, chunk generation, research, and a final cleanup step.
- For a validated concrete example of this pattern, see [`three-js-vanilla-clean-return.md`](three-js-vanilla-clean-return.md).

## Prompt Template

```text
Create a workflow that builds a multi-file documentation pack about <topic>.

During execution, intermediate chunk artifacts may be generated per run.
What matters at the end is the published artifact tree returned to the user.

Requirements:
- Research first.
- Scaffold the pack structure and manifest.
- Generate chunk content in a loop.
- Add a cleanup/publish phase that rewrites or copies the intermediate chunks into stable final files matching the requested filenames and folders.
- Add a final runtime_verify_phase that validates the published outputs, not only the intermediate run artifacts.

The final return should look like:
- <stable file 1>
- <stable file 2>
- <stable directory tree>
- outputs/verify.txt with last line VERIFY_OK
```

## Expected Workflow Shape

1. `agent_phase` research
2. `agent_phase` scaffold
3. `derive_input_phase` from the manifest or report into chunk inputs
4. `loop_phase` over chunk work items
5. `agent_phase` cleanup/publish
6. `runtime_verify_phase` final verify

## Intermediate Outputs

- Research notes
- Manifest JSON
- Per-run chunk files such as `run-<id>/chunk.md`

## Published Outputs

- Stable final docs such as `docs/.../<slug>.md` or the exact filenames requested by the user
- Stable README or index file
- Any manifest or handoff note that points to the stable outputs first
- `outputs/verify.txt`

## Validation Expectations

- Final validators should check the stable published files.
- A per-run directory alone is not a sufficient final return unless the user explicitly asked for archival layout.
- README or index files should point to the stable files first and only mention run artifacts as provenance.
