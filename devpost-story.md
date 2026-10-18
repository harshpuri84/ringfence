## Inspiration

Work often starts away from the keyboard: on a walk, in a conversation, or while explaining a bug. A note preserves the thought but leaves the work of turning it into a prompt and starting an agent for later. We wanted spoken work to become reviewable software before returning to the desk.

Bee also hears unfinished ideas, other speakers and nearby media. Ringfence separates what a classifier thinks it heard from what the software is allowed to do.

## What it does

Say the task. Review the work. Approve the pull request.

Ringfence gives actions three rings:

- **Ring 0: notes.** An idea becomes a line in a private intent file.
- **Ring 1: private branch.** A specific software task can start an agent in its own Git worktree. The agent plans with read-only tools, asks for missing decisions through Bee todos, and resumes when a spoken reply matches its open question. It builds with file tools; Ringfence runs the configured checks.
- **Ring 2: publication.** Empty results are discarded. Failed or missing checks cannot request publication. A completed result waits for diff review and a tick in Bee. The publisher verifies the target fork and exact Git tree before committing, pushing and opening a PR.

If the target or completed result changes, publication is refused. The approval todo includes the repository, changed files and a tree fingerprint. A media gate and a self-contained-request gate reduce accidental work; they are probabilistic, not authentication.

## How we built it

Bee stream events become segment windows. A classifier answers typed questions about intent, the request utterance, nearby media and replies to open questions. A deterministic TypeScript engine applies thresholds, trust levels and rate limits. Claude CLI plans and implements in a separate worktree. Bee todos carry questions and results; the changefeed supplies approval ticks. A React/Vite dashboard shares the same engine with live mode.

The current public fixtures use a clearly labelled Claude Haiku stand-in for the Jev interface. A Jev adapter exists, but we do not claim a successful Jev evaluation. When a task names an undocumented Bee event, the agent receives the observed payload shape with values redacted, rather than inventing a contract.

## Challenges and what we learned

An early agent implementation invented an undocumented payload and passed the repository checks. Grounding it in the observed shape helped. Another implementation broke Ctrl+C despite building successfully. Passing checks is useful evidence, not a replacement for review.

Bee's segment summaries, todos and changefeed made the interaction possible. Durable segment replay, media provenance, reliable wearer identity and improved alert delivery would make it easier to expand. The repository includes a public-safe friction summary and links to two open upstream CLI fixes: stream reconnection and clean error output.

A Git worktree isolates changes from the main checkout; it is not an OS sandbox. Repository checks still run code on the host. Use a trusted, disposable environment, inspect diffs before approving, and remember that model requests and Bee todos use cloud services before any publication approval.

## Accomplishments

The 18 October audit added publication binding to the original target, branch, HEAD and completed tree, full PR-path inspection, validated live classifier responses and safe retry behavior. All 59 offline tests pass, GitHub CI passes on Node 24, the production build passes, and the dependency audit reports zero vulnerabilities at audit time.

The public replay uses 17 synthetic speech windows and recorded September agent runs. It exposes classifier mistakes and labels synthetic content and the stand-in. Screenshots and offline Git tests are not a fresh device-to-GitHub demonstration.

## Try it

Use the audited version on the `codex/submission-audit` branch (PR #1). With Node 24 or newer:

```bash
git clone --branch codex/submission-audit https://github.com/harshpuri84/ringfence.git
cd ringfence
npm ci --ignore-scripts
npm test
npm run build
npm run check
npm run dev
```

Open http://localhost:5188. The replay needs no Bee login, API keys or paid calls. Replay the day, inspect the task/question and media windows, switch to shadow mode, and simulate an approval. Replay controls never call GitHub or start an agent.

Source: https://github.com/harshpuri84/ringfence

Audited changes: https://github.com/harshpuri84/ringfence/pull/1

## What's next

Record a fresh public device-to-PR demo of the audited publisher, improve restart recovery, and isolate checks at the operating-system level before wider unattended use. The daily cost setting is a per-pass admission threshold, not a hard billing ceiling; classifier and failed-pass costs are separate. Watch alerts were not demonstrated: the measured todo notifications reached the phone.
