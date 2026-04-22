# Skill Compiler Beta Testing Guide

Thank you for helping us test the Skill Compiler. Your feedback directly shapes whether this feature ships.

---

## What is the Skill Compiler?

The Skill Compiler turns one-off agent sessions into reusable, typed skills.

After you finish a task with Cursor or OpenCode, you send the session to Cepage. Cepage extracts the execution graph, replaces hardcoded values like "Stripe" with typed parameters like `{{payment_provider}}`, runs a dry-run validation, and emits a skill you can call from the CLI, SDK, or MCP server.

Think of it as turning a bespoke consulting engagement into a repeatable product.

---

## What We Need You to Do

Over the next week, use the Skill Compiler at least twice:

1. **Once with Cursor** — Import a Cursor session where you built something real (a feature, an integration, a refactor).
2. **Once with OpenCode** — Run OpenCode through Cepage with capture enabled, then compile the result.

For each compilation, walk through the full pipeline: capture, review parameters, dry-run, publish (or reject). Then tell us what worked and what did not.

---

## Step-by-Step Testing

### Test 1: Import a Cursor Session

1. Open Cursor and complete a real task. Build a feature, scaffold a project, or refactor some code.
2. In your terminal, run:
   ```bash
   cepage import cursor --latest
   ```
3. Review the compilation page in your browser.
4. Check the detected parameters. Are they accurate? Did Cepage miss anything? Flag any false positives.
5. Run a dry-run:
   ```bash
   cepage skills dry-run <skill-slug> --input key=value
   ```
6. Either publish the skill or reject it.
7. If you published it, try running it again with different inputs.

### Test 2: Capture an OpenCode Session

1. Run OpenCode through Cepage:
   ```bash
   cepage run opencode --capture --prompt "Your real task here"
   ```
2. Wait for the session to complete.
3. Open the compilation review page.
4. Review detected parameters, adjust the JSON Schema if needed.
5. Dry-run and publish (or reject).
6. Run the compiled skill with new inputs.

---

## What to Look For

**Parameter detection accuracy**

Did Cepage find the right things to parameterize? Did it miss a hardcoded value that should have been a parameter? Did it suggest parameters that should stay hardcoded?

**JSON Schema quality**

Are the inferred types correct? Are required fields actually required? Do descriptions make sense?

**Dry-run usefulness**

Does the dry-run catch real problems? Does it pass when it should fail, or vice versa?

**End-to-end flow**

How smooth is the full pipeline from session completion to published skill? Where do you get stuck?

---

## How to Report Issues

Found a bug? Have feedback? Here is what we need:

1. **What you did** — The exact command or UI action.
2. **What you expected** — What should have happened.
3. **What happened instead** — The actual behavior, including any error messages.
4. **Your environment** — OS, Node version, Cursor or OpenCode version, Cepage commit hash (`git rev-parse --short HEAD`).
5. **Session data** — If possible, include the session JSON or a sanitized version.

Drop it all in the #beta-feedback channel (or open a GitHub issue if you prefer public tracking).

---

## Timeline

| Day | What to do |
|-----|-----------|
| Day 1 | Install or update Cepage, read this guide |
| Day 2–3 | Complete Test 1 (Cursor import) |
| Day 4–5 | Complete Test 2 (OpenCode capture) |
| Day 6 | Fill out the feedback form |
| Day 7 | Optional: test edge cases, stress test with a large session |

The beta period lasts **one week** from your start date. We will send a reminder on Day 5.

---

## The "Would Use" Question

At the end of the week, we will ask you one simple question:

> **"Would you use the Skill Compiler as part of your regular workflow?"**

This is our Phase 1 Gate metric. We need a "yes" rate above 50% from 10 beta users to proceed. Be honest. A "no" with detailed feedback is more useful than a polite "yes" with no detail.

---

## Quick Reference

```bash
# Import latest Cursor session
cepage import cursor --latest

# Import and publish in one step
cepage import cursor --latest --publish

# Capture OpenCode session
cepage run opencode --capture --prompt "Your task"

# Dry-run a compiled skill
cepage skills dry-run <slug> --input key=value

# Run a published skill
cepage skills run <slug> --input key=value

# List your skills
cepage skills list
```

See [`getting-started-compiler.md`](./getting-started-compiler.md) for the full guide.

---

*Last updated: 2026-04-22*
