# Ringfence

Local draft prepared 18 October 2026. Nothing was sent to Devpost by this audit. Registration, eligibility, deadline and exact form fields could not be verified because the Devpost connector returned internal errors. This document is working copy, not a completed official form.

## One-line Summary

Say a coding task out loud. Your agent prepares a checked branch, asks questions through Bee, and waits for your approval to publish a pull request.

## Problem

Useful work often starts away from the keyboard: on a walk, while explaining a bug, or in conversation. Capturing a note preserves the thought but leaves the work of turning it into a prompt, finding context and starting an agent for later. A wearable could close that gap, but it also hears half-finished ideas, other speakers and media. Treating every sentence as a command would be costly and intrusive.

## Solution

Ringfence connects what Bee hears to a coding agent through three explicit levels of action. An idea becomes a private note. A specific software task can start an agent on a separate Git branch and worktree. Publishing the work requires review and a tick in the Bee app.

The agent first plans with read-only tools. If a decision is missing, it asks a question as a Bee todo. A spoken reply resumes the same session only when the classifier matches it to that open question. The agent builds with file tools, and Ringfence runs the repository's configured checks. Empty results are discarded; failed or missing checks cannot request publication.

The classifier estimates what was said. Deterministic code decides what may happen. That separation is the central idea: make useful action possible before the user returns to the keyboard, while reserving publication for an explicit decision.

## Why This Matters

The target user is a developer already using a coding agent who wants conversations and spoken ideas to become reviewable work. The benefit is a shorter path from “we should fix this” to a checked branch, with a clear point for human judgment. Ringfence is a prototype for that interaction, with measured Bee feedback that could improve the platform for other developers.

## How We Used AI

A swappable classifier answers typed questions about task intent, the request utterance, whether the request is self-contained, nearby media and whether a reply answers an open question. Code applies thresholds, rate limits and the publication policy. The current public fixtures use a clearly labelled Claude Haiku stand-in for the Jev interface; Jev's adapter exists, but no successful Jev run is claimed.

Claude CLI plans and implements changes in a separate worktree. The agent receives nearby Bee summaries and observed event shapes to reduce guessing about undocumented payloads. It can ask for clarification and make one repair attempt after failed checks. The optional climate hold delays todos during tense conversation; breath nudges are off by default.

## How We Used Codex

The original implementation and recorded agent runs predate this review. In the 18 October audit, Codex reviewed the engine, runner, live approval path, public claims and dependency tree; reproduced the baseline checks; hardened the publication boundary; added regression tests and live response validation; updated vulnerable transitive dependencies; tested the browser replay; and prepared this packet. These are observed changes in this review, not claims that Codex created the original project.

## Key Features

- Spoken tasks start isolated Git work; ideas remain notes.
- Clarification travels through Bee todos and spoken answers.
- Media and fragment gates reduce accidental starts.
- Configured checks must pass before publication is offered.
- Approval is bound to the completed Git tree. Changed results need a new run and review.
- Publication verifies the fork and its push destination, rejects protected paths and pushes an explicit commit/ref.
- The dashboard offers a synthetic, account-free replay with recorded runs and visible classifier limitations.

## Architecture

Bee stream → capture JSONL → segment window → classifier → deterministic policy engine → private note or Claude worktree → configured checks → Bee todo → tick via changefeed → publication preflight → PR on the fork.

The React/Vite dashboard shares the TypeScript engine with live mode. Live state is served on loopback with hostname and origin checks. Real speech and audit logs stay outside the repository, but model requests and Bee todos use their respective cloud services before publication approval.

## Testing Instructions

Use Node 24 or later. From the repository root:

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run check
npm run dev
```

Open http://localhost:5188. The page starts at the end of a synthetic day. Inspect the two pending PR requests, click one “Tick to approve”, then replay the day. Inspect a media window and the 09:22 fragment; neither starts work. Switch “Agent trust” to shadow to see what would have happened without execution. These controls only replay local data.

The test suite uses real Git/worktrees with fake Claude and GitHub commands; no model calls or external publication occur. `npm run check` reports stored classifier accuracy, including misses; it is a diagnostic, not a quality certification. [TESTING.md](TESTING.md) documents the separate live device test.

## Existing Devpost Entry

The participant supplied a private Devpost entry-management link after this packet was drafted. It is retained locally outside the public repository. It is not a public project or demo URL. The connected browser redirects to sign-in and the connector still returns an internal error, so the entry's saved write-up, assets, registration and publication status have not been verified. This audit has not changed or finalized that entry. Reuse the existing entry once authenticated rather than creating a duplicate.

## Public Demo Link

PENDING: no hosted replay URL is configured. The reproducible local dashboard above is available without Bee or credentials. Do not treat localhost as a public demo link.

## Public Repository Link

https://github.com/harshpuri84/ringfence — public, MIT. Audit changes are proposed in a PR; use its head for this draft until merged.

Related Bee CLI contributions, both still open when checked 18 October:

- https://github.com/bee-computer/bee-cli/pull/16 — reconnect the stream with backoff.
- https://github.com/bee-computer/bee-cli/pull/17 — send error usage to stderr so JSON stdout stays parseable.

## Demo Video

PENDING: record and add a public, playable URL. [demo/script.md](demo/script.md) targets 2:40 with a working-task cold open, spoken clarification, passing checks and approval. This is a script, not a video. The maximum duration and accepted host must be checked against the live event requirements.

## Screenshot Shot List

1. Dashboard overview showing synthetic-data and stand-in labels.
2. Task window and the agent's clarification question.
3. Media window showing why no work started.
4. Approval recorded in the replay, explicitly labelled simulated.
5. Shadow mode suppressing agent execution.

Screenshots live in `docs/submission/`; they demonstrate the replay, not a fresh Bee device run. The original full-day screenshot remains in `docs/dashboard-end-of-day.png`.

## Submission Readiness Notes

The audit report is [docs/audit-2026-10-18.md](docs/audit-2026-10-18.md). A public-safe feedback attachment is [docs/friction-log.md](docs/friction-log.md); the original transcript-bearing log was not copied into this repository.

- [x] Prepare working product copy, architecture and testing instructions.
- [x] Provide public source and MIT licence.
- [x] Harden publication and add offline regressions.
- [x] Prepare a shorter demo script and public-safe platform feedback.
- [ ] Record a fresh device demo, including a real tick-to-PR result on a disposable fork; review its diff before approval.
- [ ] Upload the video and add its public URL; prepare a gallery cover if required.
- [ ] Verify current event rules, eligibility, registration, deadline, track and every required form answer.
- [ ] Merge or otherwise make the audited source version easy for judges to reach.
- [ ] Perform the final Devpost submission only after the participant reviews the packet and explicitly authorizes it.

## Known Limitations

Git worktrees isolate changes, not operating-system access. Checks execute repository code on the host; stripped environment keys do not prevent reading host files or using the network. Use a disposable environment for untrusted inputs. Review diffs before ticking. Approval is not a security verdict.

Speakers are not reliably identified in the recorded Bee observations. The stand-in is probabilistic and unstable on a small fixture set; the media gate is not an adversarial security boundary. The daily budget is a per-pass admission threshold, not a hard billing ceiling, and excludes classifier costs. Restarted live processes do not recover pending work. September device measurements and runs are historical evidence, not a fresh live-device validation of this PR.

## TODO Official Form Fields

Exact questions and IDs are unverified; no official fields have been invented. Intended positioning is the Bee track and an open-source contribution, subject to the actual form. No AWS Builder claim is made: this implementation does not integrate an AWS runtime service.

Before final entry, read the live event's rules and submission requirements, confirm registration and participant eligibility, select the applicable track/prize options, attach the requested feedback format and add the device video, gallery assets and project URL. No rules agreement or registration has been recorded locally.

## Draft Product Feedback

**What worked:** Bee's stream, todos and changefeed made the spoken task → clarification → approval loop possible. Segment summaries gave useful context, and the CLI/library let the prototype connect those surfaces quickly.

**What needs work:** document event schemas and timestamp units, expose segment history with a replay cursor, make todo completions available on the stream and distinguish media from live speech. See the dated reproduction summaries in `docs/friction-log.md`.

**Onboarding:** the largest cost was discovering API contracts in source and observed payloads, rather than in a stable reference. A versioned schema and small stream-to-todo example would help.

**Would build again:** the prototype shows a useful interaction. Trustworthy speaker attribution, media provenance, durable stream delivery and device alert parity would make it easier to expand.

**Feature priorities:** high — stream replay and segment REST access, media provenance and wearer identity; medium — todo stream parity and watch alerts. These priorities describe this application, not official judging requirements.
