# Demo script: target 2:40

Working recording plan, not a finished video. Confirm the actual event's duration, host, language, device and branding requirements before uploading. A previous review recorded a three-minute limit; it was not verified live on 18 October.

## Record the evidence first

Take A: record Bee on the intended device, the phone and the live terminal/dashboard using only the public test lines in `demo/lines.json`. Use a disposable environment and a fork you control. Set `RINGFENCE_CHECK` to the trusted repository checks before running `--execute --effects`. This incurs model calls and writes real Bee todos. Inspect the worktree diff before ticking. Capture the actual PR URL and checked branch. Do not imply that a replay tick is a real GitHub publication.

Take B: record narration with Bee capture off. The raw take may take 8–12 minutes because segments, inference and the changefeed add latency. Cut the waits with a visible “wait shortened” label or timestamps. Preserve the sequence and show failures honestly. No private conversations, account pages, tokens, copyrighted clips or music are needed.

## Edit and narration

| Time | Evidence on screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Cold open: actual spoken task, then the branch appearing. Label elapsed time across the cut. | “I'm away from the keyboard, talking through a bug. Ringfence hears a specific task through Bee and starts preparing the work. Here is the branch it made.” |
| 0:15–0:32 | Three rings and the task in the dashboard. | “Ideas become notes. Tasks get their own branch. Publishing needs my review and a tick in Bee. The classifier estimates what I said; code decides what can happen.” |
| 0:32–0:55 | Planning terminal; real clarification todo on the phone; spoken reply. | “The agent first reads and plans. When it needs a decision, it asks through Bee. I answer out loud. The reply has to match its open question before that same session continues.” If no question occurs, show the real direct-build path and use the recorded clarification path separately, with a label. |
| 0:55–1:16 | Changed files and configured checks passing. | “The agent edits with file tools. Ringfence runs the checks and gives it one chance to repair a failure. An empty result is discarded. Missing or failed checks cannot ask to publish.” |
| 1:16–1:43 | Review the actual diff; phone approval showing target/files; tick; cut the wait; actual PR URL on the fork. | “I review the diff, then tick. The publisher checks the fork, destination and exact completed result. If the work changed, it refuses. Otherwise it pushes that commit and opens the pull request. This is the point where the work becomes public.” |
| 1:43–2:03 | Synthetic media and fragment windows, clearly labelled replay. | “Not everything heard is a request. This replay shows a nearby video and a reply fragment being ignored. The current demo uses a labelled Claude stand-in for the classifier. It is imperfect, which is why publication is a separate decision.” |
| 2:03–2:20 | Rings and README safety boundary. | “Separate branches protect the main checkout. Checks still run on the host, so this is a prototype for trusted, disposable environments. Speech goes to model providers before approval; the tick gates publication.” |
| 2:20–2:34 | Public friction summary, then the two upstream PRs. | “Building this exposed useful Bee improvements: durable segments, media provenance, speaker identity and better approval delivery. Two CLI fixes are open upstream, with a public friction summary.” |
| 2:34–2:40 | End card: Ringfence, repository. | “Say the task. Review the work. Approve the pull request.” |

## Before export

- Keep the central proof: a real device task, an inspectable change, passing checks and an actual approval-to-PR outcome. Do not replace this with only an animation or the scripted dashboard.
- Keep the synthetic and stand-in labels visible whenever using the replay. Recorded agent runs are from 26 September; they do not prove the current publisher ran on GitHub.
- Show the watch/device as the microphone and the phone for notifications. Watch alert delivery was not demonstrated.
- Do not call the private branch a security sandbox or imply all data stays local before approval.
- Target 2:40 including titles and end card, leaving buffer if the event limit is confirmed as 3:00. Verify the exported duration with `ffprobe` and check the uploaded URL while signed out.
- Add the final URL to `devpost-submission.md`.
