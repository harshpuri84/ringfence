import type { JudgeRequest, JudgeResponse } from '../engine/types.ts'

// TypeScript casts are not a boundary for an HTTP/model response. Reject incomplete or non-finite
// judgments before the live engine can act; fixture replay retains its historical response shapes.
export function validateResponse(req: JudgeRequest, value: unknown): JudgeResponse {
  const response = value as JudgeResponse
  if (!response || typeof response.model !== 'string' || !response.answers) throw new Error('Invalid judge response')
  for (const [id, q] of Object.entries(req.questions)) {
    const a = response.answers[id]
    const fail = () => { throw new Error(`Invalid judge answer: ${id}`) }
    if (!a || a.type !== q.type) fail()
    if (a.type === 'noul') {
      if (!Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) fail()
    } else {
      const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.type === 'score' ? q.criteria.map((_, i) => String(i)) : []
      const probs = a.probabilities
      if (!probs || Object.keys(probs).length !== keys.length) fail()
      if (keys.some((k) => !Number.isFinite(probs[k]) || probs[k] < 0 || probs[k] > 1)) fail()
      if (Math.abs(Object.values(probs).reduce((s, p) => s + p, 0) - 1) > 0.025) fail()
      if (a.type === 'choice' && (!keys.includes(a.choice) || probs[a.choice] < Math.max(...Object.values(probs)))) fail()
      if (a.type === 'score' && (!Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1)) fail()
    }
  }
  return response
}
