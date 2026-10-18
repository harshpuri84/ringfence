# Ringfence

Working copy prepared 18 October 2026. The existing Devpost entry has now been opened while signed in, and draft content has been saved through the web form. It remains DRAFT, not a finalized entry. The connector still returns internal errors; participant eligibility and legal agreements remain unconfirmed. The video requirements and deadline were subsequently read directly on the official rules page. Actual form fields were read directly from the authenticated form.

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

The existing entry was verified while signed in: it began as Untitled, DRAFT, with 1/5 steps complete. Its title and pitch are now Ringfence; the story, technology tags, repository link and organizer answers have been saved as draft content. The management URL and identifiers stay in local private working notes.

The project preview address is https://devpost.com/software/ringfence-vht8ni. This was observed in the editor and is **not a claim that the draft is publicly accessible or finalized**. Public project copy is mirrored in [devpost-story.md](devpost-story.md). The participant-confirmed entrant and learning answers have also been saved. The missing video and unchecked legal declarations mean the form is not complete.

## Public Demo Link

PENDING: no hosted replay URL is configured. The reproducible local dashboard above is available without Bee or credentials. Do not treat localhost as a public demo link.

## Public Repository Link

https://github.com/harshpuri84/ringfence — public, MIT. Audit changes are proposed in a PR; use its head for this draft until merged.

Related Bee CLI contributions, both still open when checked 18 October:

- https://github.com/bee-computer/bee-cli/pull/16 — reconnect the stream with backoff.
- https://github.com/bee-computer/bee-cli/pull/17 — send error usage to stderr so JSON stdout stays parseable.

## Demo Video

PENDING: record and add a public, playable URL. [demo/script.md](demo/script.md) targets 2:40 with a working-task cold open, spoken clarification, passing checks and approval. This is a script, not a video. The official rules page requires a video under three minutes on publicly visible YouTube or Vimeo, functioning on the intended platform and showing actual Bee data use. See [demo/video-requirements.md](demo/video-requirements.md).

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
- [x] Prepare and upload the concept cover and five replay screenshots.
- [ ] Upload the required demo video and add its public URL.
- [x] Inspect the authenticated form and verify video requirements/deadline on the organizer website.
- [ ] Complete participant eligibility declarations and terms review when the participant chooses to proceed; draft-only authorization remains in force.
- [ ] Merge or otherwise make the audited source version easy for judges to reach.
- [ ] Perform the final Devpost submission only after the participant reviews the packet and explicitly authorizes it.

## Known Limitations

Git worktrees isolate changes, not operating-system access. Checks execute repository code on the host; stripped environment keys do not prevent reading host files or using the network. Use a disposable environment for untrusted inputs. Review diffs before ticking. Approval is not a security verdict.

Speakers are not reliably identified in the recorded Bee observations. The stand-in is probabilistic and unstable on a small fixture set; the media gate is not an adversarial security boundary. The daily budget is a per-pass admission threshold, not a hard billing ceiling, and excludes classifier costs. Restarted live processes do not recover pending work. September device measurements and runs are historical evidence, not a fresh live-device validation of this PR.

## TODO Official Form Fields

The authenticated form was inspected on 18 October. Draft choices: Bee primary track; new project; AWS Builder No (with N/A explanation); Open Source Yes. The GitHub contribution/repository/username, feature requests, friction-log URL, five developer-feedback answers and AI-tools answer were prepared from repository evidence.

The participant supplied the entrant setup, country and learning/career answers; these were saved and read back from the form. Personal answer values stay in private working notes rather than this public packet. Age of majority, eligible jurisdiction and non-affiliation declarations remain unchecked. The final Official Rules/Devpost Terms agreement is also unchecked. No finalization was attempted.

The project-details form marks the video URL required. It accepts JPG/PNG/GIF gallery images up to 5 MB each, recommends 3:2, and allows 15 images. The optional attachment limit is 35 MB. No Codex session ID was requested by the inspected form. Participant eligibility still needs confirmation. The organizer rules page lists 23 October 2026, 12:00 Pacific Time (21:00 Europe/Amsterdam) as the deadline. The participant explicitly requested draft-only preparation; no final entry is authorized.

## Draft Product Feedback

**What worked:** Bee's stream, todos and changefeed made the spoken task → clarification → approval loop possible. Segment summaries gave useful context, and the CLI/library let the prototype connect those surfaces quickly.

**What needs work:** document event schemas and timestamp units, expose segment history with a replay cursor, make todo completions available on the stream and distinguish media from live speech. See the dated reproduction summaries in `docs/friction-log.md`.

**Onboarding:** the largest cost was discovering API contracts in source and observed payloads, rather than in a stable reference. A versioned schema and small stream-to-todo example would help.

**Would build again:** the prototype shows a useful interaction. Trustworthy speaker attribution, media provenance, durable stream delivery and device alert parity would make it easier to expand.

**Feature priorities:** high — stream replay and segment REST access, media provenance and wearer identity; medium — todo stream parity and watch alerts. These priorities describe this application, not official judging requirements.
