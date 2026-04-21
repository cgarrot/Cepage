# File Organizer

Use this when the user wants a workflow that can inspect, classify, and organize a directory of files.

## Goal

- Inventory the input directory.
- Propose or execute a stable organization plan.
- Publish a manifest and a summary.

## Shape

`inventory -> classify -> publish -> runtime_verify`

## Rules

- Keep the inventory explicit before any reorganization.
- Prefer deterministic grouping rules.
- Publish stable manifest files for later review.

## Outputs

- `outputs/file-index.json`
- `outputs/file-plan.json`
- `outputs/file-summary.md`
- `outputs/verify.txt`
