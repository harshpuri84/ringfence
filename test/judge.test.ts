import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import type { Judgment } from '../src/engine/types.ts'
import assert from 'node:assert/strict'
import { validateResponse } from '../src/judge/validate.ts'
import type { JudgeRequest } from '../src/engine/types.ts'

const req: JudgeRequest = { model: 'test', state: {}, questions: {
  media: { type: 'noul', instructions: 'media?' },
  intent: { type: 'choice', instructions: 'intent?', criteria: { none: '', task: '' } },
  climate: { type: 'score', instructions: 'climate?', criteria: ['calm', 'tense'] },
} }
const valid = () => ({ model: 'test', answers: {
  media: { type: 'noul', noul: 0.2 },
  intent: { type: 'choice', choice: 'task', probabilities: { none: 0.1, task: 0.9 } },
  climate: { type: 'score', score: 0.3, probabilities: { '0': 0.7, '1': 0.3 } },
} })

test('complete finite judgments pass validation', () => {
  const r = valid()
  assert.equal(validateResponse(req, r), r)
})
test('missing answers fail closed', () => {
  const r = valid()
  Reflect.deleteProperty(r.answers, 'media')
  assert.throws(() => validateResponse(req, r), /media/)
})
test('non-finite and out-of-range decisions fail closed', () => {
  for (const value of [NaN, Infinity, -0.1, 1.1]) {
    const r = valid(); r.answers.media.noul = value
    assert.throws(() => validateResponse(req, r), /media/)
  }
})
test('invented options and invalid probability distributions fail closed', () => {
  for (const probabilities of [{ task: 1 }, { none: NaN, task: 1 }, { none: 0.9, task: 0.9 }, { other: 0.1, task: 0.9 }]) {
    const r = valid(); Object.assign(r.answers.intent, { probabilities })
    assert.throws(() => validateResponse(req, r), /intent/)
  }
})
test('wrong answer types and invalid scores fail closed', () => {
  const r = valid(); r.answers.climate.score = NaN
  assert.throws(() => validateResponse(req, r), /climate/)
  r.answers.climate.score = 0.3; r.answers.media.type = 'choice'
  assert.throws(() => validateResponse(req, r), /media/)
})


test('recorded stand-in responses match their original request contracts', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../fixtures/judgments.standin.json', import.meta.url), 'utf8')) as Record<string, Judgment>
  for (const j of Object.values(fixtures)) assert.equal(validateResponse(j.request, j.response), j.response)
})
