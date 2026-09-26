// Judge benchmark on the scripted day: accuracy against the script's labels, stability across repeats, latency, cost.
// Every judge gets the same requests, built with today's questions. Open questions come from the stored stand-in
// judgments and the recorded runs, so the requests do not depend on the judge under test.
//   node --env-file-if-exists=.env scripts/judge-bench.ts standin --repeat 3
//   node --env-file-if-exists=.env scripts/judge-bench.ts jev --repeat 3      # needs TYPESAFE_API_KEY in .env
//   node scripts/judge-bench.ts --compare                                      # side by side, from the saved files
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ChoiceA, Judgment, JudgeResponse, NoulA, ScoreA, Window } from '../src/engine/types.ts'
import { jev } from '../src/judge/jev.ts'
import { standin } from '../src/judge/standin.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { buildRequest } from '../src/engine/questions.ts'
import { openQuestionsAt } from '../src/engine/engine.ts'
import type { AgentRun } from '../src/engine/types.ts'

const dir = new URL('../fixtures/', import.meta.url)
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const windows: Window[] = JSON.parse(readFileSync(new URL('day.windows.json', dir), 'utf8'))
const stored: Record<string, Judgment> = JSON.parse(readFileSync(new URL('judgments.standin.json', dir), 'utf8'))
const runs: Record<string, AgentRun> = JSON.parse(readFileSync(new URL('agent-runs.json', dir), 'utf8')).runs
const requests = Object.fromEntries(windows.map((w, i) => [w.id, buildRequest(w, {
  previousSummary: windows[i - 1]?.chunkText, now: w.endedAt,
  openQuestions: openQuestionsAt(windows, stored, runs, DEFAULT_POLICY, w.endedAt),
})]))

interface Call { windowId: string; latencyMs: number; costUsd?: number; intent: string; pTask: number; media: number; selfContained: number; climate: number }
const fileFor = (judge: string) => new URL(`bench.${judge}.json`, dir)

function summarise(calls: Call[]) {
  const t = DEFAULT_POLICY.thresholds
  const labelled = calls.filter((c) => windows.find((w) => w.id === c.windowId)?.label)
  const label = (c: Call) => windows.find((w) => w.id === c.windowId)!.label!
  const byWindow: Record<string, Call[]> = {}
  for (const c of calls) (byWindow[c.windowId] ??= []).push(c)
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  const spreads = (f: (c: Call) => number) => Object.values(byWindow).map((cs) => spread(cs.map(f)))
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const lat = calls.map((c) => c.latencyMs).sort((a, b) => a - b)
  // What the engine would do with one answer set, in the engine's order: media first, then task, then note.
  const decision = (c: Call) =>
    c.media >= t.media ? 'media'
      : c.intent === 'task' && c.pTask >= t.task ? (c.selfContained >= t.selfContained ? 'agent' : 'fragment')
        : c.intent === 'note' ? 'note' : 'none'
  // A flip: the same window, judged again, gets a different decision.
  const flips = Object.values(byWindow).filter((cs) => new Set(cs.map(decision)).size > 1).length
  return {
    calls: calls.length,
    windows: Object.keys(byWindow).length,
    intentAccuracy: labelled.filter((c) => c.intent === label(c).intent).length / labelled.length,
    mediaAccuracy: labelled.filter((c) => (c.media >= 0.5) === label(c).media).length / labelled.length,
    climateMae: mean(labelled.map((c) => Math.abs(c.climate - label(c).climate))),
    meanSpreadMedia: mean(spreads((c) => c.media)),
    maxSpreadMedia: Math.max(...spreads((c) => c.media)),
    meanSpreadTask: mean(spreads((c) => c.pTask)),
    windowsThatFlip: flips,
    p50Ms: lat[Math.floor(lat.length / 2)],
    p95Ms: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))],
    usdPerCall: calls.some((c) => c.costUsd !== undefined) ? mean(calls.map((c) => c.costUsd ?? 0)) : null,
  }
}

if (process.argv.includes('--compare')) {
  const rows: Record<string, unknown> = {}
  for (const judge of ['standin', 'jev']) if (existsSync(fileFor(judge))) rows[judge] = summarise(JSON.parse(readFileSync(fileFor(judge), 'utf8')).calls)
  console.table(rows)
  process.exit(0)
}

const judge = process.argv[2]
if (judge !== 'standin' && judge !== 'jev') { console.error('usage: judge-bench.ts standin|jev [--repeat 3] [--concurrency 4], or --compare'); process.exit(1) }
const call: (r: Judgment['request']) => Promise<JudgeResponse> = judge === 'jev' ? jev : standin
const REPEAT = Number(arg('--repeat') ?? 3)
const CONCURRENCY = Number(arg('--concurrency') ?? 4)

const jobs = windows.flatMap((w) => Array.from({ length: REPEAT }, () => w.id))
const calls: Call[] = []
let failed = 0
async function worker() {
  for (let id = jobs.shift(); id; id = jobs.shift()) {
    const t0 = Date.now()
    try {
      const r = await call(requests[id])
      const a = r.answers
      calls.push({
        windowId: id, latencyMs: Date.now() - t0, costUsd: r.costUsd,
        intent: (a.intent as ChoiceA).choice, pTask: (a.intent as ChoiceA).probabilities.task ?? 0,
        media: (a.media as NoulA).noul, selfContained: (a.task_self_contained as NoulA).noul, climate: (a.climate as ScoreA).score,
      })
      writeFileSync(fileFor(judge), JSON.stringify({ judge, repeat: REPEAT, at: new Date().toISOString(), calls }, null, 1) + '\n')
    } catch (e) {
      failed++
      console.error(`${id}: ${(e as Error).message.slice(0, 160)}`)
      if (/ 401| 403/.test((e as Error).message)) process.exit(1)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`${judge}: ${calls.length} calls, ${failed} failed`)
console.table({ [judge]: summarise(calls) })
