# Ringfence video requirements and recording checklist

Checked against the organizer's official rules page in the authenticated browser on 18 October 2026: https://amazonappdev2026.devpost.com/rules . The Devpost MCP connector continued to return internal errors; this is a direct website check, not a recorded rules acknowledgment or submission approval.

## Organizer requirements

- Keep the video under three minutes; the rules say judges need not watch past three minutes.
- Show the project working on its intended device/platform.
- For the Bee track, connect to data recorded and processed by a real Bee device or an Apple Watch running Bee software. Show the application actually using that Bee data to deliver value; mentioning Bee or showing only synthetic fixture playback does not demonstrate the required live interaction.
- Upload to YouTube or Vimeo, make the video publicly visible, and put its URL in the required demo-video field.
- Use English, or supply an English translation of the video and other materials.
- Use third-party trademarks, copyrighted music or other material only with the necessary permission.

The rules' submission deadline is 23 October 2026 at 12:00 Pacific Time, which is 21:00 Europe/Amsterdam on that date. No final submission is authorized: the participant explicitly requested draft-only preparation.

## Recommended Ringfence video (2:40)

| Time | Proof to record |
|---|---|
| 0:00–0:15 | Speak a concrete public test task into the real Bee device/Watch; show it arriving in Ringfence. |
| 0:15–0:32 | Explain the three authority levels: note, prepared branch, publication after review. |
| 0:32–0:55 | Show the agent's actual question as a Bee todo and your spoken answer. If it asks nothing, show that direct-build path honestly and label any separate recorded clarification example. |
| 0:55–1:16 | Show the generated diff and passing repository checks. |
| 1:16–1:43 | Review the actual diff, tick approval yourself, and show the resulting PR on a disposable fork. This is a future demo step, not an action performed during draft preparation. |
| 1:43–2:03 | Optionally show media/fragment rejection, clearly labelling synthetic replay footage and the Claude classifier stand-in. |
| 2:03–2:34 | Briefly explain host-execution limits, the Bee feedback and open-source contribution. |
| 2:34–2:40 | End on the project name and source link. |

Record the real interaction first, then a separate voice-over with capture off. Shorten waits with visible time cuts; the raw take may take 8–12 minutes. Show phone alerts rather than implying watch alert delivery. The concept cover is artwork, not device evidence.

Before upload, check the exported duration, speech intelligibility, absence of private data, and signed-out playback. Captions, 1080p output and the 20-second duration buffer are recommendations, not separately stated organizer requirements. The full voice-over plan is in `demo/script.md`.
