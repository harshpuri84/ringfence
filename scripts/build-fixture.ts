// Scripted day -> Bee-shaped stream events (as `bee stream --types all --json` emits them, per FRICTION-LOG F28/F35/F36)
// -> windows the engine consumes. Live mode builds the same windows from the real stream.
//   node scripts/build-fixture.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Window } from '../src/engine/types.ts'

const dir = new URL('../fixtures/', import.meta.url)
const script = JSON.parse(readFileSync(new URL('day.script.json', dir), 'utf8'))

const CONVERSATION_ID = 99000001
const CONVERSATION_UUID = randomUUID()
let utteranceId = 3400000000
let chunkId = 317000000
const events: unknown[] = []
const windows: Window[] = []

events.push({ type: 'new-conversation', conversation: { id: CONVERSATION_ID, conversation_uuid: CONVERSATION_UUID, state: 'CAPTURING', device_id: 'synthetic' } })

for (const w of script.windows) {
  const start = Date.parse(`${script.date}T${w.time}${script.tz_offset}`)
  let t = start
  const utterances = w.utterances.map((text: string) => {
    const id = ++utteranceId
    const spokenAt = new Date(t).toISOString()
    const dur = Math.max(2, text.split(' ').length * 0.38)
    events.push({
      type: 'new-utterance',
      conversation_uuid: CONVERSATION_UUID,
      utterance: { text, spoken_at: spokenAt, start: (t - start) / 1000, end: (t - start) / 1000 + dur, sample_id: randomUUID() },
    })
    t += (dur + 2 + (id % 5)) * 1000
    return { id, text, spokenAt }
  })
  events.push({
    type: 'new-utterance-chunks', conversation_id: CONVERSATION_ID, transcription_id: 15500001,
    chunks: [{ id: ++chunkId, chunk_text: w.chunk_text, tags: ['CONVERSATION'], utterances: utterances.map((u: { id: number }) => u.id) }],
  })
  events.push({ type: 'update-conversation-summary', conversation_id: CONVERSATION_ID, short_summary: w.chunk_text })
  windows.push({
    id: w.id, startedAt: new Date(start).toISOString(), endedAt: new Date(t).toISOString(),
    place: w.place, chunkText: w.chunk_text, utterances, label: w.label,
  })
}

writeFileSync(new URL('day.events.jsonl', dir), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
writeFileSync(new URL('day.windows.json', dir), JSON.stringify(windows, null, 2) + '\n')
console.log(`${events.length} events, ${windows.length} windows, ${windows.reduce((n, w) => n + w.utterances.length, 0)} utterances`)
