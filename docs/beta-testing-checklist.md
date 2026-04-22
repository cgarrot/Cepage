# Skill Compiler Beta Testing Checklist

Use this checklist to track the beta testing process from recruitment to Go/No-Go decision.

---

## Phase 1: Recruit Beta Users

Goal: 10 confirmed beta testers with diverse agent usage.

- [ ] Draft recruitment message (see [`beta-recruitment.md`](./beta-recruitment.md))
- [ ] Identify 20 candidate users (target 10 confirmations)
  - [ ] Cursor-heavy users (5+ sessions per week)
  - [ ] OpenCode users (autonomous runs)
  - [ ] Mixed users (both agents)
  - [ ] At least 2 users from non-technical backgrounds (PM, designer)
- [ ] Send recruitment messages
- [ ] Track responses in a spreadsheet or Notion table
- [ ] Confirm 10 participants with clear start dates
- [ ] Add participants to a dedicated #beta-feedback channel or thread

---

## Phase 2: Set Up Beta Environment

- [ ] Verify all participants can run `pnpm dev` and have a working Cepage install
- [ ] Confirm Docker and Postgres are running for each participant
- [ ] Verify daemon is connected (check "Daemon" badge in UI)
- [ ] Ensure participants have Cursor or OpenCode installed and functional
- [ ] Share the [`beta-testing-guide.md`](./beta-testing-guide.md) with all participants
- [ ] Share the feedback form link (or JSON schema for API submissions)
- [ ] Set up a shared tracker for compilation events (optional: wire analytics export)

---

## Phase 3: Distribute Beta Guide

- [ ] Send guide at least 24 hours before beta start
- [ ] Schedule a 15-minute kickoff call (optional but recommended)
- [ ] Clarify expectations: 2 compilations minimum, feedback form by Day 7
- [ ] Remind participants about the "Would Use" question and its importance
- [ ] Confirm everyone knows how to reach the team for blockers

---

## Phase 4: Collect Feedback

- [ ] Send a midpoint check-in on Day 3 or 4
- [ ] Send a reminder on Day 5
- [ ] Monitor #beta-feedback for real-time issues
- [ ] Triage bugs as they come in (critical vs. nice-to-have)
- [ ] Confirm each participant submits the feedback form
- [ ] Export analytics events from `CompilerService` for the beta period

---

## Phase 5: Analyze Results

- [ ] Compile all feedback form responses
- [ ] Calculate the **Would Use rate** (yes / total respondents)
- [ ] Calculate average ratings for:
  - [ ] Compilation quality
  - [ ] Parameter accuracy
  - [ ] UI ease of use
- [ ] Catalog all bugs reported and their severity
- [ ] Catalog all missing feature requests
- [ ] Review analytics events:
  - [ ] Total compilation attempts
  - [ ] Success vs. failure rate
  - [ ] Average compilation duration
  - [ ] Most common failure stages
- [ ] Identify patterns across Cursor vs. OpenCode users

---

## Phase 6: Go/No-Go Decision

**Gate criteria for Phase 1:**

| Metric | Threshold | Status |
|--------|-----------|--------|
| Would Use rate | > 50% | TBD |
| Beta users completing | >= 8 of 10 | TBD |
| Critical bugs blocking usage | 0 | TBD |

- [ ] Schedule a 30-minute review meeting with the team
- [ ] Present the Would Use rate and supporting data
- [ ] Review the top 3 bugs and top 3 feature requests
- [ ] Make a Go/No-Go decision
- [ ] If Go: define the Phase 2 scope and timeline
- [ ] If No-Go: define the rework needed and re-beta timeline
- [ ] Thank all participants (regardless of outcome)
- [ ] Share a summary of findings with the broader community

---

## Post-Beta Actions

- [ ] Archive all feedback forms and session data
- [ ] File GitHub issues for every confirmed bug
- [ ] Add feature requests to the roadmap backlog
- [ ] Update documentation based on common confusion points
- [ ] Write a beta retrospective for the team

---

*Last updated: 2026-04-22*
