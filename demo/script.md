# Demo: 3 minutes

Screen: the live dashboard (`http://localhost:5188/?live`) on the left, a terminal on the right, the phone with the Bee app on camera. Live mode runs with `--execute --repo <bee-cli fork> --effects` and `RINGFENCE_CHECK` set to the repo's checks. Everything spoken is public: it is about building this project.

Two takes. Take A is the live run: say only the lines from `demo/lines.json`, near the watch. Take B is the voice-over, recorded with the watch off, because Bee hears the narration too, and narration phrased as an instruction can start an agent. A single live take runs 8 to 12 minutes: Bee closes a segment one to three minutes after you speak, the judge takes 16 to 92 s a window, and a tick takes about 35 s to reach the changefeed. The video cuts those waits and keeps a clock on screen, so the cuts are visible.

Rehearse without the watch: `node scripts/build-rehearsal.ts`, then `npm run live -- --standin --execute --repo <fork> --from demo/rehearsal.jsonl --answer "<rehearsal_answer from demo/lines.json>" --stay`.

| Time | On screen | Said (take B unless marked) |
|---|---|---|
| 0:00 | Watch on wrist. Dashboard at `/?live`, empty | "Bee hears my whole day. Most apps turn that into notes. Ringfence turns it into work, inside three rings." |
| 0:08 | Explainer hero: the rings and the thesis line | "Speech is ambiguous, so I don't try to guess right every time. I make being wrong cheap. Ring 0 only touches me. Ring 1 is a sandbox branch I can delete. Ring 2 leaves my machine, and never without my tick." |
| 0:25 | Take A, walking: the reflection segment from `lines.json`. CUT to the window with its Jev answers (they land 16 to 92 s after the window) | (the two reflection lines) |
| 0:36 | The new window opens its "Asked Jev" view: the intent row, note above the 0.5 mark | "Every window goes to Jev, TypeSafe's classifier: typed questions in, probabilities out. Code owns the thresholds. Jev says note, so ring 0 writes one line to a private file. Until my Jev key works, a labelled Claude stand-in answers the same questions. The badge says so." |
| 0:55 | Take A: the task line | (the task line) |
| 1:05 | "Asked Jev": intent task over 0.6, the task line, self-contained over 0.5. Terminal: `agent.started`, then "grounded with N observed event shape(s)" | "A task that names what to change, so ring 1 starts an agent on its own branch. Bee never documented this event. Ringfence has seen it on the stream, so the agent gets the real shape, with my words redacted." |
| 1:22 | CUT. Phone: "Agent asks: …" todo. Take A: the `rehearsal_answer` line. Terminal: `agent.resumed` | "It planned with read-only tools and asked me a question. I answer out loud. Jev matches my answer to the open question, and the same session carries on." If it asks nothing: "It planned with read-only tools, asked nothing, and builds." |
| 1:49 | CUT. Terminal: checks pass. Phone: "Branch ready … checks pass", then "Open PR … Tick to approve" | "It built with file tools only. No shell. Ringfence ran the repo's own checks before anything reached my phone." |
| 2:00 | Phone: tick. CUT about 35 s, clock visible. Terminal: "tick seen in changefeed", then the PR URL. Browser: the PR on the fork | "I tick. Bee's stream never sends todo events, so Ringfence reads my tick from the changefeed. Now, and only now, a pull request opens on my fork." |
| 2:15 | Explainer: the media meter at 0.70 over the 0.6 mark, then the real-day table | "On 25 September a YouTube Short nearby told my wearable to read my Instagram history. The media question scored 0.70, over the cut-off, and nothing ran. That whole day, 596 lines, one agent would have started: the task I read out for this demo." |
| 2:36 | Dashboard: "What Amazon could ship", five rows | "Where the vision hits Bee's limits, it says so. Five requests, each measured: todo events on the stream, alerts on the watch, media tags, speaker identity, and chunks over REST." |
| 2:50 | GitHub: bee-cli #16 and #17, then the ringfence repo | "Two fixes to Bee's CLI are open upstream. Ringfence is MIT, and my friction log goes in with the entry." |
| 2:58 | End card | |

Notes for the take:
- The agent does not always ask a question. Both paths are in the script, and both were tested on 26 September on the fork.
- If the agent's first pass is wrong, keep it: the review and the ring-2 tick are the point.
- Ring 1 is set to auto for the demo. If the "Agent trust" control is in frame, say so.
- Alerts arrive on the phone, not the watch. Show the phone for questions and ticks; the watch appears only as the microphone.
- Before recording, tick one real "Open PR" on the fork once. The commit, push and `gh pr create` path is tested against a local repo, not yet against GitHub.
- If a Jev key arrives before recording, drop the stand-in sentence at 0:36 and run `npm run judge` so the scripted day matches.
