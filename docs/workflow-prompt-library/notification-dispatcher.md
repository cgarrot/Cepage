# Notification Dispatcher

Use this when the user wants one event or message adapted across multiple channels.

## Goal

- Turn a source brief into per-channel notification variants.
- Publish a dispatch manifest and a readable summary.
- Leave a verification marker for downstream delivery automation.

## Shape

`prepare -> adapt_per_channel -> publish -> runtime_verify`

## Rules

- Keep the source brief canonical.
- Make channel differences explicit in the dispatch plan.
- Publish a stable manifest instead of only transient send logs.

## Outputs

- `outputs/dispatch-plan.json`
- `outputs/dispatch-summary.md`
- `outputs/verify.txt`
