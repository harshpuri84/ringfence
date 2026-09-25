// Judge every scripted window, in order, so each request sees the open questions of that moment.
//   node scripts/judge-fixture.ts              # Jev if TYPESAFE_API_KEY is set, else stops
//   node scripts/judge-fixture.ts --standin    # Claude Haiku stand-in, labelled as such
import { readFileSync, writeFileSync } from 'node:fs'
import type { AgentRun, Judgment, Window } from '../src/engine/types.ts'
import { buildRequest } from '../src/engine/questions.ts'
import { openQuestionsAt } from '../src/engine/engine.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { jev } from '../src/judge/jev.ts'
import { standin } from '../src/judge/standin.ts'

const dir = new URL('../fixtures/', import.meta.url)
const useStandin = process.argv.includes('--standin')
if (!useStandin && !process.env.TYPESAFE_API_KEY) {
  console.error('No TYPESAFE_API_KEY. Set it in .env, or run with --standin (Claude Haiku, labelled).')
  process.exit(1)
}
const judgeName = useStandin ? 'standin:claude-haiku' : 'jev'
const windows: Window[] = JSON.parse(readFileSync(new URL('day.windows.json', dir), 'utf8'))
const runs: Record<string, AgentRun> = JSON.parse(readFileSync(new URL('agent-runs.json', dir), 'utf8')).runs
const outFile = new URL(`judgments.${useStandin ? 'standin' : 'jev'}.json`, dir)
const judgments: Record<string, Judgment> = {}

for (let i = 0; i < windows.length; i++) {
  const w = windows[i]
  const openQuestions = openQuestionsAt(windows, judgments, runs, DEFAULT_POLICY, w.endedAt)
  const request = buildRequest(w, { previousSummary: windows[i - 1]?.chunkText, openQuestions, now: w.endedAt })
  const t0 = Date.now()
  const response = useStandin ? await standin(request) : await jev(request)
  judgments[w.id] = { windowId: w.id, judge: useStandin ? judgeName : response.model, latencyMs: Date.now() - t0, request, response }
  const a = response.answers as Record<string, { choice?: string; noul?: number; score?: number }>
  console.log(
    `${w.id} ${w.startedAt.slice(11, 16)} intent=${a.intent.choice} media=${a.media.noul?.toFixed(2)} climate=${a.climate.score?.toFixed(2)}` +
      `${a.answer_to ? ` answer_to=${a.answer_to.choice}` : ''} open=${openQuestions.length} ${Date.now() - t0}ms`,
  )
  writeFileSync(outFile, JSON.stringify(judgments, null, 1) + '\n')
}
console.log(`wrote ${outFile.pathname}`)
