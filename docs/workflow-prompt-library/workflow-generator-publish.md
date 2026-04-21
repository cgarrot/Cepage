# Workflow Generator And Publisher

## Use This Prompt When

- The user wants a workflow that generates another workflow.
- The generated workflow must be reusable, importable, or publishable.
- The final artifact must be clean and ready for reuse.

## Prompt Template

```text
Create a workflow that generates a child workflow for <goal>.

The generated child workflow can be assembled from intermediate artifacts,
but the final returned artifact must be a clean published workflow output.

Requirements:
- Assemble the child workflow.
- Lint or validate the workflow transfer.
- Validate the child workflow topology before publish, including missing structured refs and orphan executable nodes.
- Publish the clean workflow artifact.
- Verify the published output before returning it.
```

## Expected Workflow Shape

1. `agent_phase` assemble
2. `validation_phase` or `agent_phase` lint
3. `agent_phase` publish
4. `runtime_verify_phase` verify

## Intermediate Outputs

- Draft workflow transfer files
- Lint reports
- Helper manifests

## Published Outputs

- Final `outputs/workflow-transfer.json`
- Any stable supporting files needed for reuse
- Final verification marker or report

## Validation Expectations

- Use `workflow_transfer_valid` before publish or import.
- Treat stable workspace-relative output paths as part of the publish contract, not only a prompt suggestion.
- The final return should be the clean published child workflow artifact, not only draft or lint-stage files.
