# Hello World Workflow

Use this when the user wants the smallest possible workflow example.

## Goal

- Create one stable output file at `outputs/hello-world.txt`.
- Add `outputs/verify.txt` proving the flow completed.

## Shape

`generate -> runtime_verify`

## Rules

- Keep the workflow minimal.
- Prefer one agent step or one compact managed flow path.
- Publish stable outputs directly instead of temporary scratch files.

## Outputs

- `outputs/hello-world.txt`
- `outputs/verify.txt`
