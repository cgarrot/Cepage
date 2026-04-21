# Analysis Pipeline Modular Architect

## Use This Prompt When

- The user already has analysis data, notes, reports, or extracted observations.
- The goal is to deepen the weak areas with web research.
- The workflow should generate new structured outputs rather than only summarize the old data.
- A modular multi-agent workflow is preferred over one large monolithic graph.

## Prompt Template

```text
Create a modular workflow that turns existing analysis data into stronger research and new generated outputs.

Requirements:
- Keep the user interaction simple and high level.
- Split the workflow into clear modules such as analysis, research, synthesis, and generation.
- Allow the workflow to use web research when it helps deepen weak or uncertain areas.
- Make each module publish explicit outputs that the next module can consume safely.
- Add a final join/integration step that assembles the module outputs into stable final deliverables.
- Add final verification so the workflow can confirm that the published outputs exist and are usable.

Target outputs:
- outputs/final-report.md
- outputs/final-manifest.json
```

## Expected Workflow Shape

1. analyze the existing data
2. deepen with research
3. synthesize the signal
4. generate the new outputs
5. join and verify

## Why This Variant Exists

- It gives the simple chat mode a strong default for generic analysis-heavy requests.
- It encourages modular decomposition instead of a single fragile graph.
- It keeps join contracts explicit so the final workflow is easier to validate.
