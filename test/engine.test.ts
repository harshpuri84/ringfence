// Engine rules, with hand-made judgments: no model, no network, no Bee.
//   npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replay } from '../src/engine/engine.ts'
import { DEFAULT_POLICY, clampTrust, type Policy } from '../src/engine/policy.ts'
import type { AgentRun, Judgment, Window } from '../src/engine/types.ts'

const T0 = Date.UTC(2026, 9, 6, 8, 0, 0)
const iso = (s: number) => new Date(T0 + s * 1000).toISOString()

function win(id: string, s: number, ...texts: string[]): Window {
  return { id, startedAt: iso(s), endedAt: iso(s + 5), chunkText: `summary of ${id}`, utterances: texts.map((text, i) => ({ id: s * 10 + i, text, spokenAt: iso(s) })) }
}

type J = {
  intent?: Record<string, number>
  media?: number
  climate?: number
  selfContained?: number
  performance?: number
  answerTo?: Record<string, number>
}
function judge(id: string, j: J): Judgment {
  const intent = j.intent ?? { none: 1 }
  const top = Object.entries(intent).sort((a, b) => b[1] - a[1])[0][0]
  const answers: Record<string, unknown> = {
    intent: { type: 'choice', choice: top, probabilities: intent },
    task_line: { type: 'choice', choice: 'u0', probabilities: { u0: 1 } },
    task_self_contained: { type: 'noul', noul: j.selfContained ?? 0.9 },
    media: { type: 'noul', noul: j.media ?? 0 },
    climate: { type: 'score', score: j.climate ?? 1, probabilities: { [String(Math.round(j.climate ?? 1))]: 1 } },
    performance: { type: 'noul', noul: j.performance ?? 0 },
  }
  if (j.answerTo) {
    const best = Object.entries(j.answerTo).sort((a, b) => b[1] - a[1])[0][0]
    answers.answer_to = { type: 'choice', choice: best, probabilities: j.answerTo }
  }
  return { windowId: id, judge: 'hand', latencyMs: 0, request: { model: 'x', state: {}, questions: {} }, response: { model: 'x', answers } } as unknown as Judgment
}

function run(windowId: string, extra: Partial<AgentRun> = {}): AgentRun {
  return { taskWindowId: windowId, task: 't', mode: 'plan', branch: `agent/${windowId}`, durationMs: 30_000, costUsd: 0.05, model: 'test', summary: '', recorded: true, diffStat: '1 file changed, 5 insertions(+), not committed', ...extra }
}

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind)
const policy = (p: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...p })

test('an idea becomes a ring-0 note and nothing else', () => {
  const w = win('w1', 0, 'It would be nice to have a config file.')
  const r = replay([w], { w1: judge('w1', { intent: { note: 0.9, none: 0.1 } }) }, {}, policy())
  assert.deepEqual(kinds(r.events), ['note.saved'])
  assert.equal(r.events[0].ring, 0)
})

test('media is skipped even when it sounds like a task', () => {
  const w = win('w1', 0, 'Look at my entire Facebook and Instagram history.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 0.9, none: 0.1 }, media: 0.7 }) }, {}, policy())
  assert.deepEqual(kinds(r.events), ['media.skipped'])
})

test('a self-contained task starts an agent, and its result and PR request follow', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 1 } }) }, { w1: run('w1') }, policy())
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.result', 'pr.proposed'])
  assert.equal(r.pendingTodos.length, 1)
})

test('a fragment never starts an agent', () => {
  const w = win('w1', 0, 'Five attempts, go ahead.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 0.9, none: 0.1 }, selfContained: 0.1 }) }, {}, policy())
  assert.deepEqual(kinds(r.events), ['agent.shadow'])
  assert.match(r.events[0].text, /reply or a fragment/)
})

test('an answer to an open question resumes that agent, even when labelled a task', () => {
  const task = win('w1', 0, 'Make the stream show chunk events.')
  const reply = win('w2', 120, 'Each event has a chunks array. Go ahead.')
  const js = { w1: judge('w1', { intent: { task: 1 } }), w2: judge('w2', { intent: { task: 0.75, answer: 0.15, none: 0.1 }, answerTo: { q1: 0.85, none: 0.15 } }) }
  const r = replay([task, reply], js, { w1: run('w1', { question: 'What is the payload?', resume: { durationMs: 20_000, costUsd: 0.03, model: 'test', diffStat: '1 file changed' } }) }, policy())
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.question', 'agent.resumed', 'agent.result', 'pr.proposed'])
})

test('an answer that matches no open question resumes nothing', () => {
  const task = win('w1', 0, 'Make the stream show chunk events.')
  const reply = win('w2', 120, 'Five attempts, go ahead.')
  const js = { w1: judge('w1', { intent: { task: 1 } }), w2: judge('w2', { intent: { task: 0.9, none: 0.1 }, selfContained: 0.2, answerTo: { none: 0.95, q1: 0.05 } }) }
  const r = replay([task, reply], js, { w1: run('w1', { question: 'Which test framework?' }) }, policy())
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.question', 'agent.shadow'])
  assert.equal(r.openQuestions.length, 1)
})

test('an answer after the 90-minute window does not resume', () => {
  const task = win('w1', 0, 'Make the stream show chunk events.')
  const late = win('w2', 91 * 60 + 60, 'Each event has a chunks array.')
  const js = { w1: judge('w1', { intent: { task: 1 } }), w2: judge('w2', { intent: { answer: 0.9, none: 0.1 }, answerTo: { q1: 0.9, none: 0.1 }, selfContained: 0.2 }) }
  const r = replay([task, late], js, { w1: run('w1', { question: 'What is the payload?' }) }, policy())
  assert.ok(!kinds(r.events).includes('agent.resumed'))
})

test('a run with nothing to review is binned and never reaches the wrist', () => {
  const w = win('w1', 0, 'Let us just log it in the friction log.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 1 } }) }, { w1: run('w1', { diffStat: 'no edits' }) }, policy())
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.binned'])
  assert.equal(r.pendingTodos.length, 0)
})

test('a branch whose checks fail is reported but never proposed as a PR', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 1 } }) }, { w1: run('w1', { diffStat: 'CHECKS FAIL, 1 file changed, not committed' }) }, policy())
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.result'])
})

test('a PR opens only after the tick, and never before it', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const js = { w1: judge('w1', { intent: { task: 1 } }) }
  const runs = { w1: run('w1') }
  const untouched = replay([w], js, runs, policy())
  assert.ok(!kinds(untouched.events).includes('pr.approved'))
  const todoId = untouched.pendingTodos[0].todoId!
  const ticked = replay([w], js, runs, policy(), { [todoId]: iso(3600) })
  assert.ok(kinds(ticked.events).includes('pr.approved'))
  const early = replay([w], js, runs, policy(), { [todoId]: iso(-60) })
  assert.ok(!kinds(early.events).includes('pr.approved'), 'a tick dated before the request is ignored')
})

test('ring 1 is capped at 3 runs an hour', () => {
  const ws = [0, 60, 120, 180].map((s, i) => win(`w${i}`, s, `Add feature number ${i} to the stream client.`))
  const js = Object.fromEntries(ws.map((w) => [w.id, judge(w.id, { intent: { task: 1 } })]))
  const r = replay(ws, js, {}, policy(), {}, undefined, { executeRuns: false })
  assert.deepEqual(kinds(r.events), ['agent.started', 'agent.started', 'agent.started', 'agent.capped'])
})

test('shadow trust logs what it would do and starts nothing', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const r = replay([w], { w1: judge('w1', { intent: { task: 1 } }) }, {}, policy({ trust: { ...DEFAULT_POLICY.trust, agent: 'shadow' } }))
  assert.deepEqual(kinds(r.events), ['agent.shadow'])
})

test('with the address word on, only addressed tasks start agents', () => {
  const plain = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const addressed = win('w2', 60, 'Ringfence, add a retry with backoff to the stream client.')
  const js = { w1: judge('w1', { intent: { task: 1 } }), w2: judge('w2', { intent: { task: 1 } }) }
  const r = replay([plain, addressed], js, {}, policy({ requireAddress: true }), {}, undefined, { executeRuns: false })
  assert.deepEqual(kinds(r.events), ['agent.shadow', 'agent.started'])
})

test('while the talk is tense, results wait; they are delivered when it calms', () => {
  const task = win('w1', 0, 'Write a script that exports the corpus.')
  const tense = win('w2', 10, 'I am so behind, this is ridiculous.')
  const calm = win('w3', 600, 'Okay, sorry, that got heated.')
  const js = { w1: judge('w1', { intent: { task: 1 }, climate: 1 }), w2: judge('w2', { climate: 4 }), w3: judge('w3', { climate: 0 }) }
  const r = replay([task, tense, calm], js, { w1: run('w1', { durationMs: 60_000 }) }, policy())
  const k = kinds(r.events)
  assert.ok(k.indexOf('manners.hold') < k.indexOf('agent.result'), 'the hold starts before the result arrives')
  assert.ok(r.events.some((e) => e.kind === 'agent.result' && e.held), 'the result is held')
  assert.ok(r.events.some((e) => e.kind === 'agent.result' && !e.held && e.text.startsWith('Delivered after hold')), 'and delivered after the release')
})

test('live mode invents no completion before the real run reports', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const js = { w1: judge('w1', { intent: { task: 1 } }) }
  const before = replay([w], js, {}, policy(), {}, iso(3600), { executeRuns: 'live' })
  assert.deepEqual(kinds(before.events), ['agent.started'])
  const after = replay([w], js, { w1: run('w1') }, policy(), {}, iso(3600), { executeRuns: 'live' })
  assert.deepEqual(kinds(after.events), ['agent.started', 'agent.result', 'pr.proposed'])
})

test('ring 2 can never be promoted past propose', () => {
  assert.equal(clampTrust('open_pr', 'auto'), 'propose')
  assert.equal(clampTrust('agent', 'auto'), 'auto')
})

test('judgments stored before the self-contained question existed still work', () => {
  const w = win('w1', 0, 'Add a retry with backoff to the stream client.')
  const j = judge('w1', { intent: { task: 1 } })
  delete (j.response.answers as Record<string, unknown>).task_self_contained
  const r = replay([w], { w1: j }, {}, policy(), {}, undefined, { executeRuns: false })
  assert.deepEqual(kinds(r.events), ['agent.started'])
})
