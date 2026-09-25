// demo/lines.json -> demo/rehearsal.jsonl, in the shape `bee stream --types all --json` emits.
//   node scripts/build-rehearsal.ts
//   node scripts/live.ts --standin --execute --repo <fork> --from demo/rehearsal.jsonl --answer "<reply>" --stay
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const dir = new URL('../demo/', import.meta.url)
const { segments } = JSON.parse(readFileSync(new URL('lines.json', dir), 'utf8')) as { segments: { summary: string; lines: string[] }[] }
const uuid = randomUUID()
let utteranceId = 3500000000
let chunkId = 318000000
const events: unknown[] = [{ type: 'new-conversation', conversation: { id: 99000002, conversation_uuid: uuid, state: 'CAPTURING' } }]
for (const seg of segments) {
  const ids: number[] = []
  for (const text of seg.lines) {
    ids.push(++utteranceId)
    // live.ts re-stamps replayed utterances with the current time.
    events.push({ type: 'new-utterance', conversation_uuid: uuid, utterance: { id: utteranceId, text, spoken_at: new Date().toISOString() } })
  }
  events.push({ type: 'new-utterance-chunks', conversation_id: 99000002, chunks: [{ id: ++chunkId, chunk_text: seg.summary, tags: ['CONVERSATION'], utterances: ids }] })
}
writeFileSync(new URL('rehearsal.jsonl', dir), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
console.log(`${events.length} events from ${segments.length} segments -> demo/rehearsal.jsonl`)
