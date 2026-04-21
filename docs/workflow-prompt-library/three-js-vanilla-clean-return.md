# Three.js Vanilla Documentation Pack (Validated)

## Use This Prompt When

- The user wants a reusable documentation or context pack about `Three.js` vanilla for game development.
- The user explicitly does **not** want `React Three Fiber`.
- The user wants a clean final handoff under `docs/context/frameworks/three-js/`, even if intermediate loop outputs are per-run.
- The workflow should stay on `cursor_agent` with `composer-2-fast`.

## Prompt Template

```text
Create a workflow that builds a multi-file documentation pack about Three.js vanilla for game development, not React Three Fiber.

Use only `cursor_agent` with model `composer-2-fast`.
Generate the workflow now, but do not run it yet.

Requirements:
- Research first using web sources and, when useful, official Three.js examples or repositories.
- Scaffold `AGENTS.md`, `outputs/research-notes.md`, `outputs/chunks-manifest.json`, and `docs/context/frameworks/README.md`.
- Derive chunk items from the manifest.
- Generate chunk drafts in a loop; intermediate per-run outputs are allowed during execution.
- Add a cleanup/publish phase that writes stable final files under `docs/context/frameworks/three-js/<slug>.md`.
- Make `docs/context/frameworks/README.md` point to the stable files first.
- Add a final `runtime_verify_phase` that validates the stable published outputs and writes `outputs/verify.txt` whose last line is exactly `VERIFY_OK`.

Target outputs:
- `AGENTS.md`
- `outputs/research-notes.md`
- `outputs/chunks-manifest.json`
- `docs/context/frameworks/README.md`
- `docs/context/frameworks/three-js/`
- `outputs/verify.txt`
```

## Expected Workflow Shape

1. `agent_phase` research
2. `agent_phase` scaffold
3. `derive_input_phase` from `outputs/chunks-manifest.json`
4. `loop_phase` over chunk work items with per-run drafts
5. `agent_phase` publish / cleanup
6. `runtime_verify_phase` final verify

## Observed Stable Outputs In The Validated Run

- `docs/context/frameworks/three-js/three-js-overview.md`
- `docs/context/frameworks/three-js/scene-camera-renderer.md`
- `docs/context/frameworks/three-js/loaders-assets-gltf.md`
- `docs/context/frameworks/three-js/animation-mixer.md`
- `docs/context/frameworks/three-js/controls-pointer-lock-fps.md`
- `docs/context/frameworks/three-js/collisions-fps-octree.md`
- `docs/context/frameworks/three-js/game-loop-input.md`
- `docs/context/frameworks/three-js/performance-pitfalls.md`

## Why This Variant Worked

- The prompt stayed compact enough for the copilot parser to apply successfully.
- It explicitly separated per-run loop artifacts from the final published deliverables.
- It named the exact stable target directory and required the README to link to it first.
- It constrained the topic to `Three.js` vanilla, which kept the generated docs away from `React Three Fiber`.

## Validation Signal

- Final `runtime_verify_phase` passed.
- `outputs/verify.txt` ended with `VERIFY_OK`.
- The published files matched the manifest slugs and the stable `three-js/` directory existed.
