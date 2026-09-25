// STAND-IN JUDGE. Not Jev. Claude Haiku via `claude -p`, asked to answer the same Jev request and return
// a Jev-shaped response. Used only because no working TypeSafe key was available on 2026-09-24.
// Every judgment it produces is labelled judge = "standin:claude-haiku".
import { spawn } from 'node:child_process'
import type { Answer, ChoiceQ, JudgeRequest, JudgeResponse, ScoreQ } from '../engine/types.ts'

function schemaFor(req: JudgeRequest) {
  const props: Record<string, unknown> = {}
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === 'noul') props[id] = { type: 'number', minimum: 0, maximum: 1 }
    else {
      const keys = q.type === 'choice' ? Object.keys((q as ChoiceQ).criteria) : (q as ScoreQ).criteria.map((_, i) => String(i))
      props[id] = {
        type: 'object',
        properties: Object.fromEntries(keys.map((k) => [k, { type: 'number', minimum: 0, maximum: 1 }])),
        required: keys,
      }
    }
  }
  return { type: 'object', properties: props, required: Object.keys(props) }
}

const PROMPT = `You are standing in for a calibrated classifier. Read STATE and answer every question in QUESTIONS.
For "noul" questions return the probability (0 to 1) that the answer is yes.
For "choice" questions return a probability for every option key; they must sum to 1.
For "score" questions return a probability for every level index ("0", "1", ...); they must sum to 1.
Judge each question independently. Be calibrated: use the full range, and do not hedge to 0.5 when the text is clear.`

export async function standin(req: JudgeRequest): Promise<JudgeResponse> {
  const input = `${PROMPT}\n\nSTATE:\n${JSON.stringify(req.state, null, 1)}\n\nQUESTIONS:\n${JSON.stringify(req.questions, null, 1)}`
  const args = ['-p', '--model', 'haiku', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(schemaFor(req)), input]
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let o = '', e = ''
    p.stdout.on('data', (d) => (o += d))
    p.stderr.on('data', (d) => (e += d))
    p.on('close', (code) => (code === 0 ? resolve(o) : reject(new Error(`claude exited ${code}: ${e.slice(0, 300)}`))))
  })
  const j = JSON.parse(out)
  const raw = j.structured_output as Record<string, number | Record<string, number>>
  if (!raw) throw new Error(`stand-in returned no structured output: ${String(j.result).slice(0, 200)}`)
  const answers: Record<string, Answer> = {}
  for (const [id, q] of Object.entries(req.questions)) {
    const v = raw[id]
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: Number(v) }
    else {
      const probs = normalise(v as Record<string, number>)
      const [best] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]
      answers[id] = q.type === 'choice'
        ? { type: 'choice', choice: best, probabilities: probs }
        : { type: 'score', score: Object.entries(probs).reduce((s, [k, p]) => s + Number(k) * p, 0), probabilities: probs }
    }
  }
  return { model: 'standin:claude-haiku', answers, usage: { input_tokens: 0, output_tokens: 0 } }
}

function normalise(p: Record<string, number>) {
  const total = Object.values(p).reduce((s, x) => s + x, 0) || 1
  return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, x / total]))
}
