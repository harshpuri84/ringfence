// Shadow day: replay one real day from Bee through the engine, with every action switched off.
// Reads that day's conversations through Bee's own library (read-only), cuts them into windows at pauses,
// judges each window, and runs the engine without starting an agent or writing a todo.
// Everything stays on this machine, in ~/.bee-capture/ringfence/shadow/. The report quotes the lines the engine
// would have acted on, so it is private: do not commit or share it. The console prints counts only.
//   node --env-file-if-exists=.env scripts/shadow-day.ts --date 2026-09-25 --standin
//   add --cached to re-run the engine on the judgments already saved (no model calls), for example after a policy change
//   add --concurrency 4 and --max-windows 300 to bound time and spend
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createBeeClient } from '@beeai/cli/lib'
import type { EngineEvent, Judgment, Window } from '../src/engine/types.ts'
import { buildRequest } from '../src/engine/questions.ts'
import { replay } from '../src/engine/engine.ts'
import { DEFAULT_POLICY, type Policy } from '../src/engine/policy.ts'
import { jev } from '../src/judge/jev.ts'
import { standin } from '../src/judge/standin.ts'

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const CACHED = process.argv.includes('--cached')
const STANDIN = process.argv.includes('--standin') || !process.env.TYPESAFE_API_KEY
const CONCURRENCY = Number(arg('--concurrency') ?? 4)
const MAX_WINDOWS = Number(arg('--max-windows') ?? 300)
const GAP_S = 30 // a pause this long starts a new window
const MAX_SPAN_S = 120
const MAX_LINES = 12

const bee = createBeeClient({ command: process.env.BEE_COMMAND ?? 'bee' })
const outDir = join(process.env.BEE_CAPTURE_DIR ?? join(homedir(), '.bee-capture'), 'ringfence', 'shadow')
mkdirSync(outDir, { recursive: true })

interface Conv { id: number; start_time: number; end_time: number | null; state: string }
interface Utt { id: number; text: string; spoken_at: number }
const ms = (t: number) => (t < 1e12 ? t * 1000 : t)

const first = await bee.api.conversations.list<{ conversations: Conv[]; next_cursor?: string; timezone: string }>({ limit: 30 })
const TZ = first.timezone || 'UTC'
const dayOf = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms(t)))
const hm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const DATE = arg('--date') ?? dayOf(Date.now())
const base = join(outDir, DATE)

let windows: Window[] = []
const convOf: Record<string, number> = {}
if (CACHED) {
  const saved = JSON.parse(readFileSync(`${base}.windows.json`, 'utf8'))
  windows = saved.windows
  Object.assign(convOf, saved.convOf)
} else {
  const convs: Conv[] = []
  let page = first
  for (;;) {
    convs.push(...page.conversations.filter((c) => dayOf(c.start_time) === DATE))
    const oldest = page.conversations.at(-1)
    if (!page.next_cursor || !oldest || dayOf(oldest.start_time) < DATE) break
    page = await bee.api.conversations.list({ limit: 30, cursor: page.next_cursor })
  }
  convs.sort((a, b) => a.start_time - b.start_time)
  let seq = 0
  for (const c of convs) {
    const full = await bee.api.conversations.get<{ conversation: { transcriptions?: { utterances: Utt[] }[] } }>(c.id)
    const utts = (full.conversation.transcriptions ?? []).flatMap((t) => t.utterances)
      .filter((u) => u.text?.trim()).sort((a, b) => a.spoken_at - b.spoken_at)
    let cur: Utt[] = []
    const close = () => {
      if (!cur.length) return
      const id = `S${String(++seq).padStart(3, '0')}`
      convOf[id] = c.id
      windows.push({
        id, startedAt: new Date(ms(cur[0].spoken_at)).toISOString(), endedAt: new Date(ms(cur.at(-1)!.spoken_at)).toISOString(),
        utterances: cur.map((u) => ({ id: u.id, text: u.text.trim(), spokenAt: new Date(ms(u.spoken_at)).toISOString() })),
      })
      cur = []
    }
    for (const u of utts) {
      const prev = cur.at(-1)
      if (prev && (ms(u.spoken_at) - ms(prev.spoken_at) > GAP_S * 1000 || ms(u.spoken_at) - ms(cur[0].spoken_at) > MAX_SPAN_S * 1000 || cur.length >= MAX_LINES)) close()
      cur.push(u)
    }
    close()
  }
  if (windows.length > MAX_WINDOWS) {
    console.error(`${windows.length} windows is over --max-windows ${MAX_WINDOWS}. Raise it to judge the whole day.`)
    process.exit(1)
  }
  writeFileSync(`${base}.windows.json`, JSON.stringify({ date: DATE, timezone: TZ, convOf, windows }) + '\n')
}

// Judge. Shadow mode never asks a question, so no window depends on another and they can run side by side.
const judgmentsFile = `${base}.judgments.json`
const judgments: Record<string, Judgment> = existsSync(judgmentsFile) ? JSON.parse(readFileSync(judgmentsFile, 'utf8')) : {}
const todo = CACHED ? [] : windows.filter((w) => !judgments[w.id])
const t0 = Date.now()
let done = 0, failed = 0
async function worker() {
  for (let w = todo.shift(); w; w = todo.shift()) {
    const i = windows.indexOf(w)
    const prev = windows[i - 1] && convOf[windows[i - 1].id] === convOf[w.id] ? windows[i - 1] : undefined
    const request = buildRequest(w, {
      previousSummary: prev?.utterances.slice(-3).map((u) => u.text).join(' ').slice(0, 300),
      openQuestions: [], now: w.endedAt,
    })
    const s = Date.now()
    try {
      const response = STANDIN ? await standin(request) : await jev(request)
      judgments[w.id] = { windowId: w.id, judge: STANDIN ? 'standin:claude-haiku' : response.model, latencyMs: Date.now() - s, request, response }
      writeFileSync(judgmentsFile, JSON.stringify(judgments) + '\n')
    } catch (e) {
      failed++
      console.error(`${w.id} not judged: ${(e as Error).message.slice(0, 120)}`)
    }
    if (++done % 10 === 0) console.log(`judged ${done} windows, ${Math.round((Date.now() - t0) / 1000)} s`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// Run the engine with every action off, then again with the task bar raised and lowered.
const run = (p: Policy) => replay(windows, judgments, {}, p, {}, undefined, { executeRuns: false })
const r = run(DEFAULT_POLICY)
const count = (evs: EngineEvent[], kind: string) => evs.filter((e) => e.kind === kind).length
const KINDS = ['media.skipped', 'note.saved', 'agent.started', 'agent.capped', 'agent.shadow', 'manners.hold'] as const
const judgeCost = Object.values(judgments).reduce((s, j) => s + (j.response.costUsd ?? 0), 0)

const convIds = [...new Set(windows.map((w) => convOf[w.id]))]
const perConv = convIds.map((cid) => {
  const ws = windows.filter((w) => convOf[w.id] === cid)
  const ids = new Set(ws.map((w) => w.id))
  const evs = r.events.filter((e) => e.windowId && ids.has(e.windowId))
  return { cid, from: hm(ws[0].startedAt), to: hm(ws.at(-1)!.endedAt), windows: ws.length, lines: ws.reduce((n, w) => n + w.utterances.length, 0), n: Object.fromEntries(KINDS.map((k) => [k, count(evs, k)])) }
})
const sweep = [0.5, 0.6, 0.7, 0.8, 0.9].map((task) => {
  const s = run({ ...DEFAULT_POLICY, thresholds: { ...DEFAULT_POLICY.thresholds, task } })
  return { task, started: count(s.events, 'agent.started'), capped: count(s.events, 'agent.capped'), fragments: count(s.events, 'agent.shadow') }
})
const judged = windows.filter((w) => judgments[w.id]).length

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`
const head = ['Conversation', 'From', 'To', 'Windows', 'Lines', 'Media skipped', 'Notes', 'Agents started', 'Capped', 'Fragments', 'Holds']
const md = [
  `# Shadow day ${DATE}`, '',
  `PRIVATE. Built from your own Bee conversations. Do not commit or share.`, '',
  `Judge: ${STANDIN ? 'Claude Haiku stand-in (not Jev)' : 'Jev'}. ${judged} of ${windows.length} windows judged. Judge cost US$${judgeCost.toFixed(2)}. Nothing was acted on.`, '',
  row(head), row(head.map(() => '---')),
  ...perConv.map((c) => row([c.cid, c.from, c.to, c.windows, c.lines, ...KINDS.map((k) => c.n[k])])), '',
  '## Task threshold sweep', '',
  row(['Task threshold', 'Agents started', 'Capped', 'Fragments']), row(['---', '---', '---', '---']),
  ...sweep.map((s) => row([s.task + (s.task === DEFAULT_POLICY.thresholds.task ? ' (default)' : ''), s.started, s.capped, s.fragments])), '',
  '## What it would have done', '',
  ...r.events.filter((e) => e.kind !== 'media.skipped').map((e) => `- ${hm(e.at)} \`${e.kind}\` ${e.text}`), '',
]
writeFileSync(`${base}.md`, md.join('\n'))

console.log(`\nshadow day ${DATE} (${TZ}): ${judged}/${windows.length} windows judged, ${failed} failed, judge cost US$${judgeCost.toFixed(2)}`)
console.table(perConv.map(({ cid, n, ...c }) => ({ conv: cid, ...c, ...n })))
console.table(sweep)
console.log(`report (private, quotes lines): ${base}.md`)
