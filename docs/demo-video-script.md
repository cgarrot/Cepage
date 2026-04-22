# Skill Compiler Demo Video — Script and Storyboard

**Target length:** 4 minutes 30 seconds (under the 5-minute limit)
**Format:** Screen recording with voiceover
**Resolution:** 1920x1080, 30fps
**Tools:** OBS or ScreenFlow for capture, minimal post-production

---

## Scene 0: Title Card (0:00–0:10)

**Visual:**
Black screen. Cepage logo appears center. Text fades in below.

**On-screen text:**

```
Cepage — The Skill Compiler
Turn one-off agent sessions into reusable systems
```

**Voiceover:**
"You built a Stripe integration in Cursor. It took five minutes and twelve dollars. Two weeks later, your PM wants the same thing for PayPal. You rebuild from scratch. Another twelve dollars. Another five minutes. Same bugs."

**Transition:** Fade to desktop.

---

## Scene 1: The Problem — A Cursor Session (0:10–0:45)

**Visual:**
Screen shows Cursor IDE with a completed session. The chat panel shows a long conversation about building a Stripe integration. The file explorer shows fourteen new files.

**Voiceover:**
"This is a typical Cursor session. Four parallel agents, fourteen files, tests, webhooks, an admin dashboard. It works. But the moment you close this tab, the knowledge is gone. If you need PayPal next week, you start over."

**Action:**
The user closes the Cursor tab. The screen pauses on the desktop.

**On-screen text (overlay):**

```
Cost per session: $12
Time per session: 5 minutes
Reusability: 0%
```

**Transition:** Cut to terminal.

---

## Scene 2: Capture — Import from Cursor (0:45–1:20)

**Visual:**
Terminal window. User types a command.

**Typed command:**

```bash
cepage import cursor --latest
```

**Output:**

```
Reading ~/.cursor/chats/composer-chat-v1.sqlite
Found session: "Stripe integration with webhooks"
Files modified: 14
Agent calls: 7
Cost: $12.34

Opening compilation review...
```

**Voiceover:**
"Cepage reads the Cursor SQLite export and reconstructs the entire execution graph. Every agent call, every file edit, every test run. Nothing is lost."

**Action:**
Browser opens automatically to the Cepage review page.

**Transition:** Cut to browser.

---

## Scene 3: Review — The Compilation Page (1:20–2:10)

**Visual:**
Cepage web UI. The review page shows:

- Left panel: Graph preview with 7 nodes (Design → Backend → Frontend → Tests → Deploy)
- Right panel: Detected parameters list

**Detected parameters shown:**

| Value | Proposed Parameter | Type |
|---|---|---|
| "Stripe" | `payment_provider` | string |
| "sk_live_xxx" | `api_key` | string |
| "https://api.stripe.com" | `api_base_url` | string |
| 12 | `webhook_event_count` | integer |

**Voiceover:**
"Cepage found four values that should be parameters. Stripe becomes payment_provider. The API key becomes a secure input. The base URL and webhook count are also extracted. I can edit the JSON Schema, add descriptions, and set defaults right here."

**Action:**
User clicks on `webhook_event_count`, changes it from required to optional, and sets a default of 10. User clicks "Preview Parameterized Graph."

**Visual change:**
The graph updates in real time. Hardcoded values are replaced with `{{parameter}}` badges.

**Transition:** Stay on browser, scroll to dry-run section.

---

## Scene 4: Dry-Run — Zero-Cost Validation (2:10–2:50)

**Visual:**
Dry-run panel. User clicks "Run Dry-Run."

**Console output streams in:**

```
[DRY-RUN] Loading mock LLM...
[DRY-RUN] Replaying graph with test parameters...
[DRY-RUN] Step 1/7: Design — PASS
[DRY-RUN] Step 2/7: Backend scaffold — PASS
[DRY-RUN] Step 3/7: Frontend scaffold — PASS
[DRY-RUN] Step 4/7: Webhook handlers — PASS
[DRY-RUN] Step 5/7: Auth integration — PASS
[DRY-RUN] Step 6/7: Tests — PASS
[DRY-RUN] Step 7/7: Deploy config — PASS

---
Mock LLM calls: 0
API cost: $0.00
Structural checks: 7/7 PASS
Parametric coverage: 3/3 required fields
Estimated cost per run: $0.45
```

**Voiceover:**
"Before I publish this skill, I run a dry-run. It replays the entire workflow with a mock LLM in an isolated worktree. It costs zero dollars. It checks that every required parameter is present, that the graph is structurally sound, and estimates the real run cost at forty-five cents. That's a twenty-seven times reduction from the original twelve dollar session."

**Action:**
User clicks "Publish Skill."

**On-screen text:**

```
Skill published: payment-integration-v1
```

**Transition:** Cut to terminal.

---

## Scene 5: Reuse — Run the Compiled Skill (2:50–3:40)

**Visual:**
Terminal window. User types a command.

**Typed command:**

```bash
cepage skills run payment-integration-v1 \
  --input payment_provider=paypal \
  --input api_key=YOUR_PAYPAL_KEY \
  --input api_base_url=https://api.paypal.com \
  --input webhook_event_count=8
```

**Output:**

```
Run ID: run_paypal_2026_04_22
Status: running

[14:32:01] Design phase started
[14:32:03] Backend scaffold complete
[14:32:08] Frontend scaffold complete
[14:32:12] Webhook handlers adapted for PayPal
[14:32:15] Auth: OAuth2 client_credentials flow
[14:32:18] Tests: 12/12 PASS
[14:32:20] Deploy config generated

Status: completed
Duration: 2m 19s
Cost: $0.47
```

**Voiceover:**
"Now I run the same workflow for PayPal. I change three parameters. The skill executes the known path, skipping exploration and retries. Two minutes, forty-seven cents. Same structure, different provider."

**Action:**
Split screen. Left side shows the Stripe run output. Right side shows the PayPal run output. Key differences are highlighted.

**On-screen text (overlay):**

```
Stripe (original):  5m 12s | $12.34 | built from scratch
PayPal (compiled):  2m 19s | $0.47  | reused skill
```

**Transition:** Cut to browser.

---

## Scene 6: OpenCode Capture — Alternative Flow (3:40–4:15)

**Visual:**
Terminal window. User runs OpenCode through Cepage.

**Typed command:**

```bash
cepage run opencode --capture --prompt "Scaffold a REST API client from an OpenAPI spec"
```

**Output:**

```
OpenCode runtime started
Session ID: sess_opencode_abc123
Capturing SSE stream...

[agent] Planning code structure...
[agent] Generating TypeScript models...
[agent] Writing request/response wrappers...
[agent] Tests: 8/8 PASS

Session complete. 23 events captured.
Compile to skill? [Y/n]:
```

**Voiceover:**
"Cursor is one path. You can also run OpenCode directly through Cepage. The full SSE stream is captured automatically. When the session ends, Cepage proposes compilation immediately."

**Action:**
User presses Y. Browser opens to the review page for the API client generator skill.

**Visual:**
Quick pan across the review page showing detected parameters: `openapi_spec_url`, `output_dir`, `language`.

**Transition:** Cut to title card.

---

## Scene 7: Closing — Where to Go Next (4:15–4:40)

**Visual:**
Black screen. Text appears line by line.

**On-screen text:**

```
Cepage — The Skill Compiler

Your agent builds features.
Cepage compiles them into reusable systems.

Get started:
  docs/getting-started-compiler.md

Star the repo:
  github.com/cgarrot/Cepage
```

**Voiceover:**
"Cepage does not replace your agent. It compiles its best work into something permanent. Get started at the link on screen. Star the repo if this resonates. Thanks for watching."

**Transition:** Fade to black. End.

---

## Recording Notes

### Prerequisites

1. Cepage stack running locally (`pnpm dev`, `pnpm daemon:dev`)
2. Cursor with at least one completed session in `~/.cursor/chats/`
3. OpenCode CLI installed
4. Clean browser profile with Cepage already logged in as `local-user`

### Preparation Checklist

- [ ] Run through the entire flow once off-camera to warm caches
- [ ] Clear the Cepage library of any existing `payment-integration` skills
- [ ] Ensure the Cursor SQLite database has a clean, recent session
- [ ] Prepare the PayPal API key (use a fake/test key for the demo)
- [ ] Set terminal font to 16pt for readability
- [ ] Hide desktop icons and notifications
- [ ] Set screen resolution to 1920x1080

### Voiceover Style

- Conversational, not corporate
- Use contractions: "it's", "you're", "that's"
- Vary sentence length
- No filler phrases: skip "In today's world", "As we all know"
- No em dashes — use commas or periods instead

### Post-Production

- Add subtle zoom on key UI elements (parameter list, dry-run output)
- Highlight changing values with a brief yellow flash
- Trim pauses longer than 1.5 seconds
- Add captions for all terminal commands
- Background music: optional, ambient, low volume

### Export Settings

- Format: MP4 (H.264)
- Resolution: 1920x1080
- Frame rate: 30fps
- Bitrate: 8 Mbps
- Audio: AAC, 192kbps

---

*Script version: 1.0*
*Last updated: 2026-04-22*
