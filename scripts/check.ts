// Success check for the engine: judge vs script labels, then the replayed day as a log.
//   node scripts/check.ts [standin|jev]
import { readFileSync, existsSync } from 'node:fs'
import type { AgentRun, ChoiceA, Judgment, NoulA, ScoreA, Window } from '../src/engine/types.ts'
import { replay, top } from '../src/engine/engine.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'

const dir = new URL('../fixtures/', import.meta.url)
const which = process.argv[2] ?? (existsSync(new URL('judgments.jev.json', dir)) ? 'jev' : 'standin')
const windows: Window[] = JSON.parse(readFileSync(new URL('day.windows.json', dir), 'utf8'))
const judgments: Record<string, Judgment> = JSON.parse(readFileSync(new URL(`judgments.${which}.json`, dir), 'utf8'))
const runs: Record<string, AgentRun> = JSON.parse(readFileSync(new URL('agent-runs.json', dir), 'utf8')).runs

let intentOk = 0, mediaOk = 0, perfOk = 0, absErr = 0, n = 0
console.log(`judge: ${Object.values(judgments)[0]?.judge}\n`)
console.log('win  label(intent,media,climate,perf)  judged(intent p, media, climate, perf)')
for (const w of windows) {
  const j = judgments[w.id]
  if (!j || !w.label) continue
  n++
  const a = j.response.answers
  const [intent, p] = top(a.intent as ChoiceA)
  const media = (a.media as NoulA).noul >= 0.5
  const perf = (a.performance as NoulA).noul >= 0.5
  const climate = (a.climate as ScoreA).score
  intentOk += +(intent === w.label.intent)
  mediaOk += +(media === w.label.media)
  perfOk += +(perf === w.label.performance)
  absErr += Math.abs(climate - w.label.climate)
  const flag = intent !== w.label.intent || media !== w.label.media ? '  <- miss' : ''
  console.log(
    `${w.id}  ${w.label.intent.padEnd(6)} ${String(w.label.media).padEnd(5)} ${w.label.climate} ${String(w.label.performance).padEnd(5)}   ` +
      `${intent.padEnd(6)} ${p.toFixed(2)}  ${(a.media as NoulA).noul.toFixed(2)}  ${climate.toFixed(2)}  ${(a.performance as NoulA).noul.toFixed(2)}${flag}`,
  )
}
console.log(`\nintent ${intentOk}/${n}   media ${mediaOk}/${n}   performance ${perfOk}/${n}   climate MAE ${(absErr / n).toFixed(2)} levels`)

for (const exhale of [false, true]) {
  const r = replay(windows, judgments, runs, { ...DEFAULT_POLICY, exhale: { ...DEFAULT_POLICY.exhale, enabled: exhale } })
  console.log(`\n--- replay, exhale ${exhale ? 'on' : 'off'}: ${r.events.length} events, agent cost US$${r.costUsd.toFixed(2)}, open questions ${r.openQuestions.length}, pending ticks ${r.pendingTodos.length}`)
  for (const e of r.events) {
    const t = new Date(Date.parse(e.at) + 2 * 3600e3).toISOString().slice(11, 19)
    console.log(`${t} ${e.ring ?? '-'} ${e.kind.padEnd(16)} ${e.held ? '[held] ' : ''}${e.text}`)
  }
}
