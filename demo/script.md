# Demo: 3 minutes

Screen: the live dashboard (`http://localhost:5188/?live`) on the left, a terminal on the right, the phone with the Bee app on camera. Live mode runs with `--execute --repo <bee-cli fork> --effects` and `RINGFENCE_CHECK` set to the repo's checks. Everything spoken is public: it is about building this project.

Rehearse without the watch: `node scripts/build-rehearsal.ts`, then live mode with `--from demo/rehearsal.jsonl --stay`.

| Time | On screen | Said |
|---|---|---|
| 0:00 | Watch on wrist, dashboard empty and live | "Bee hears my whole day. Most apps turn that into notes. This one turns it into work, inside three rings I drew." |
| 0:15 | The rings panel | "Ring 0 only touches me. Ring 1 runs in a sandbox I can throw away. Ring 2 leaves my machine, and never without a tick." |
| 0:30 | Walking. Say the two lines from `demo/lines.json`. The first window appears and becomes a ring-0 note | (the reflection line, then the task line) |
| 0:50 | Agent starts. Dashboard shows "grounded with observed event shapes" in the terminal | "Bee never documented this event. Ringfence has seen it on the stream, so it hands the agent the real shape, with my words redacted." |
| 1:10 | **If the agent asks** about the payload: the question arrives on the phone as a Bee todo. Answer out loud with the `rehearsal_answer` line. **If it asks nothing**, skip to 1:30 | "It asked. I answer out loud." |
| 1:30 | Terminal: "checks pass, 1 file changed". Wrist card: branch ready, checks pass | "It planned with read-only tools, built with file tools only, and the repo's own checks ran before it told me anything." |
| 1:50 | Phone: tick the PR request in the Bee app. Dashboard shows the tick about 35 s later, then the PR opens on the fork | "Nothing left my machine until I ticked. Bee's stream never sends todo events, so Ringfence reads my tick from the changefeed." |
| 2:10 | Scroll to "What Amazon could ship" | "Where this vision hits Bee's limits, it says so. Five requests, each measured. Alerts only reach my phone, so a breath before I present waits for the watch." |
| 2:25 | The media row | "This morning a YouTube Short told my wearable to read my whole Instagram history. Bee transcribed it as if I said it. Ringfence treated it as media and did nothing." |
| 2:40 | The upstream PRs, bee-computer/bee-cli#16 and #17 | "Two of these I fixed myself: the stream reconnects instead of dying, and help text stays out of the data." |
| 2:52 | Repo | "Open source, MIT, and every finding is reproducible." |

Notes for the take:
- The agent does not always ask a question. Both paths are in the script.
- If the agent's first pass is wrong, keep it: the review and the ring-2 tick are the point.
- The judge badge says "stand-in" until a Jev key works. Say so if it is on screen.
- Alerts arrive on the phone, not the watch. Show the phone for questions and ticks; the watch appears only as the microphone.
