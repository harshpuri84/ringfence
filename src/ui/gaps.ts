import type { EngineEvent } from '../engine/types.ts'

// What Amazon could ship. Each request is a measured gap between this vision and Bee as it is today.
// Evidence cites FRICTION-LOG.md; the two 25 Sep tests are not in the log yet.

export interface Gap {
  id: string
  short: string
  request: string
  today: string
  unlocks: string
  evidence: string
  status: 'measured' | 'retest pending'
}

export const GAPS: Gap[] = [
  {
    id: 'todo-events', short: 'todo events',
    request: 'Send todo events on the stream',
    today: 'Listed as event types, never delivered. A tick shows up only by polling the changefeed, about 35 s later.',
    unlocks: 'Your tick opens the pull request at once.',
    evidence: 'Tested 25 Sep 2026: app tick, CLI update and CLI create, with --types all and by name. Not yet in the friction log.',
    status: 'measured',
  },
  {
    id: 'watch-alerts', short: 'alerts on the watch',
    request: 'Deliver todo alerts to the watch',
    today: 'An alarm todo buzzed the phone and never the watch: about 30 s late with the phone in use, on time with it locked.',
    unlocks: 'Questions and results arrive on the wrist, and so can a box-breathing nudge just before you present. Until then the demo uses phone alerts.',
    evidence: "Tested 25 Sep 2026, twice. Pending one check: the Watch app's mirror setting for Bee.",
    status: 'measured',
  },
  {
    id: 'media-tags', short: 'media tags',
    request: 'Tag chunks that come from media',
    today: 'Every chunk is tagged CONVERSATION, including 15 live chunks captured with music playing. A podcast is transcribed as if you said it.',
    unlocks: 'The agent never acts on the TV. Today Ringfence guesses from the words, and the stand-in judge got one of 17 wrong.',
    evidence: 'F17, F35; live raw-stream watch on 25 Sep 2026 (event names and tags only recorded).',
    status: 'measured',
  },
  {
    id: 'speakers', short: 'speaker identity',
    request: 'Identify the wearer at real-world scale',
    today: '10,336 of 10,336 utterances came back as Unknown.',
    unlocks: "Act only on the wearer's own words. A colleague's \"someone should\" stays a note, and someone else's \"five\" cannot answer your agent.",
    evidence: 'F16, F24',
    status: 'measured',
  },
  {
    id: 'chunks-rest', short: 'chunks on REST',
    request: 'Serve chunks over REST, with a replay cursor on the stream',
    today: 'Segments exist only on an undocumented stream event. The stream dies after about 43 h with no replay, so a missed segment is gone.',
    unlocks: 'Every window in this replay survives a restart, without a capture daemon on your machine.',
    evidence: 'F35, F37',
    status: 'measured',
  },
]

export const GAP = Object.fromEntries(GAPS.map((g) => [g.id, g])) as Record<string, Gap>

// Which Bee capabilities an engine event leans on.
export function gapsFor(e: EngineEvent): string[] {
  switch (e.kind) {
    case 'pr.approved': return ['todo-events']
    case 'pr.proposed': return ['watch-alerts', 'todo-events']
    case 'agent.question':
    case 'agent.result':
    case 'exhale.nudge': return ['watch-alerts']
    case 'media.skipped': return ['media-tags']
    case 'agent.started':
    case 'agent.resumed':
    case 'note.saved': return ['speakers']
    case 'manners.hold': return ['speakers', 'media-tags']
    default: return []
  }
}
