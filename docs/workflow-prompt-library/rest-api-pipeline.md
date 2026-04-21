# REST API Pipeline

Use this when the user wants a reusable workflow that talks to one or more REST APIs.

## Goal

- Call the required API endpoints.
- Normalize the responses into a stable result contract.
- Publish explicit verification output.

## Shape

`fetch -> transform -> publish -> runtime_verify`

## Rules

- Keep external I/O isolated from synthesis steps.
- Persist raw responses before transforming them.
- Publish final outputs in a stable tree, not only run-scoped scratch files.

## Outputs

- `outputs/raw-responses.json`
- `outputs/result.json`
- `outputs/verify.txt`
