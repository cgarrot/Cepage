# Scheduled Report Generator

Use this when the user wants a recurring report workflow.

## Goal

- Gather inputs for the current reporting window.
- Create a human-readable report and a structured machine-readable summary.
- Leave a verification marker for downstream automation.

## Shape

`collect -> summarize -> publish -> runtime_verify`

## Rules

- Keep the reporting window explicit.
- Separate source collection from final report generation.
- Publish stable report artifacts.

## Outputs

- `outputs/report.md`
- `outputs/report.json`
- `outputs/verify.txt`
