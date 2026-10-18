# Testing Ringfence

Two test layers, plus a shadow-day replay and classifier benchmark. The automated tests need no Bee, no model and no network. The live test needs a Bee, a phone and about 20 minutes.

## 1. Automated tests

```bash
npm test
```

| File | What it proves |
|---|---|
| `test/engine.test.ts` | The rules, with hand-made judgments: notes, media skipped, fragments gated, answer-first, the 90-minute answer window, binning, no pull request for failing checks, the tick, the ring-1 cap, shadow trust, the address word, the manners hold and release, the ring-2 ceiling, and ids that stay stable when a run reports late |
| `test/runner.test.ts` | Ring 1 and ring 2 with a fake `claude` and a fake `gh` on `PATH`, real git and real checks, no network: read-only planning, a build pass with no shell, question and resume in the same session, the denial guard, one repair pass, `CHECKS FAIL`, the daily budget, pull requests only to the fork, the real commit-push-PR path against a local bare repo, nothing committed when checks fail at tick time, refusing a non-fork origin or a branch that changes `.github/`, retrying a failed push, checks without your keys, the agent in restricted mode, one agent at a time |

| `test/judge.test.ts` | Complete classifier contracts, missing/non-finite answers, invented options, invalid distributions and compatibility with the stored stand-in responses. |

The tests were checked by breaking the code on purpose (28 September 2026): removing the `CHECKS FAIL` rule fails 1 engine test, removing the fragment gate fails 2, reverting live mode's late-run fix fails 1, and removing the check environment's key stripping or the fork check fails 1 runner test each.

## 2. Live test, about 20 minutes

You need `bee status` to show you logged in, the `claude` CLI, `gh` logged in, and a fork of a repo to point the agents at, with its dependencies installed. For the Bee CLI:

```bash
export RINGFENCE_CHECK="bun install --ignore-scripts && bun run typecheck && bun run build && bun test"
scripts/up.sh --standin --effects --execute --repo ~/code/bee-cli
```

Drop `--standin` once a Jev key is in `.env`.

`up.sh` starts the capture (unless one runs already), the dashboard and live mode. Open `http://localhost:5188/?live` on the laptop. Ctrl+C stops everything it started. `scripts/down.sh` stops everything, wherever it was started.

Windows close when Bee sends a segment, which takes one to three minutes, or after three minutes of quiet. Say each line, then keep talking normally or wait. Speak for a minute before step 2 so the capture has seen a segment event: the agent is grounded with the shapes seen so far.

| # | Say or do | Expect | Where |
|---|---|---|---|
| 1 | "It would be nice if the CLI had a config file." | `note.saved`. No todo, no agent | terminal, `~/.bee-capture/ringfence/intent.md` |
| 2 | "Ringfence, make bee stream print the text of new-utterance-chunks events." | `agent.started`, then "grounded with N observed event shape(s)", N at least 1 | terminal, dashboard |
| 3 | If a todo says "Agent asks: …", answer it out loud in one sentence | `agent.resumed`, then a "Branch ready … checks pass" todo | phone, terminal |
| 4 | With no question open, say only "Five attempts, go ahead." | `agent.shadow`: "Sounds like a reply or a fragment". No agent | terminal |
| 5 | Play a video where someone gives instructions, for example a coding tutorial | `media.skipped`. No agent, no todo | terminal, dashboard |
| 6 | Tick "Open PR for agent/…? Tick to approve." in the Bee app | About 35 to 45 s later: "tick seen in changefeed", then `ring 2:` with a pull request URL on your fork | terminal, `gh pr list --repo <you>/<fork>` |
| 7 | Give a task, then argue for a minute ("I am so behind, nothing works, this is ridiculous"), then calm down | `manners.hold`, the result marked `[held]`, then `manners.release` and "Delivered after hold" | terminal, dashboard climate chart |

Things that are expected and are not bugs:

- A todo tick takes about 35 s to reach the changefeed. The stream never sends todo events.
- Alarm todos buzz the phone, not the watch.
- Bee tags every segment `CONVERSATION`, music and video included. The judge does the media work.
- A result that says `CHECKS FAIL` never gets an "Open PR" todo. That is the rule working.
- The fourth task inside an hour is `agent.capped`.

Cost, measured 25 to 26 September 2026: an agent run cost US$0.07 to US$0.30, from plan to checked branch. The Claude Haiku stand-in judge cost about US$0.036 a window through `claude -p`. Live mode checks the US$5 daily admission threshold before each agent pass (`RINGFENCE_MAX_USD_PER_DAY`). A pass can cross it; classifier calls and failed-pass costs are not covered.

### After the test

```bash
scripts/down.sh
node scripts/todos.ts            # lists the todos Ringfence wrote. Read-only
node scripts/todos.ts --delete   # deletes those todos and no others
git -C ~/code/bee-cli worktree list
```

Agent branches stay in `~/.ringfence/worktrees` until you remove them with `git worktree remove`.

## 3. Shadow day

Replay a whole real day through the engine with every action off:

```bash
node scripts/shadow-day.ts --date 2026-09-25 --standin
node scripts/shadow-day.ts --date 2026-09-25 --cached   # re-run the engine on saved judgments, no model calls
```

It reads that day's conversations through Bee's library, cuts them into windows at 30-second pauses, judges each window and runs the engine without acting. It prints counts per conversation and a sweep of the task threshold. The full report goes to `~/.bee-capture/ringfence/shadow/`. It quotes your own speech, so it stays on your machine.

## 4. Judge benchmark

The same 17 requests from the scripted day go to either judge, three times each. It reports accuracy against the script's labels, how far scores move between runs, how many windows flip a decision, latency and cost.

```bash
node scripts/judge-bench.ts standin --repeat 3
node --env-file-if-exists=.env scripts/judge-bench.ts jev --repeat 3   # needs TYPESAFE_API_KEY or AI_GATEWAY_API_KEY
node scripts/judge-bench.ts --compare
```


## Publication audit regressions (18 October)

The suite now validates full model response contracts and exercises publication against a local bare Git repository. It rejects changed targets, differing or multiple push URLs, protected paths already committed on the starting branch, check-created changes, missing checks, changed results and unrelated commits after a failed push. Successful publication is idempotent within the process. A test transport redirects only the explicit verified GitHub push URL to a local bare repository; no GitHub API write occurs.

Approval requires a passing configured check and a result whose branch, HEAD, tree and target still match. The todo includes target, changed-file list and tree fingerprint; inspect the actual worktree diff before ticking. Worktrees and scrubbed environments are not an OS sandbox. Checks still execute repository code on your host; use a disposable environment for untrusted tasks.

The old September runs remain historical evidence. Re-run the live test with the current publisher before recording a device demo. The replay, screenshots and offline Git tests alone do not demonstrate a fresh tick-to-GitHub path.
