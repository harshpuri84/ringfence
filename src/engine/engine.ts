import type { AgentRun, ChoiceA, EngineEvent, Judgment, NoulA, OpenQuestion, ScoreA, Window } from './types.ts'
import { type ActionClass, type Policy, clampTrust } from './policy.ts'

// Deterministic replay: windows + judgments + policy + approvals -> events.
// The same step() runs live; only the clock and the effects differ.

export interface ClimatePoint { at: string; windowId: string; raw: number | null; smooth: number | null; media: boolean; holding: boolean }

interface RunState { id: string; windowId: string; task: string; branch: string; run: AgentRun; status: 'running' | 'asked' | 'resumed' | 'done' }
interface Scheduled { at: string; kind: 'run.done' | 'resume.done'; runId: string }

export interface ReplayResult {
  events: EngineEvent[]
  climate: ClimatePoint[]
  openQuestions: OpenQuestion[]
  pendingTodos: EngineEvent[]
  costUsd: number
}

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60000

export function top(a: ChoiceA): [string, number] {
  let best = ['none', -1] as [string, number]
  for (const [k, p] of Object.entries(a.probabilities)) if (p > best[1]) best = [k, p]
  return best
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((x) => x.length > 2).slice(0, 3).join('-') || 'task'

export function replay(
  windows: Window[],
  judgments: Record<string, Judgment>,
  runs: Record<string, AgentRun>,
  policy: Policy,
  approvals: Record<string, string> = {}, // todoId -> ISO time the user ticked it
  untilIso?: string,
  opts: { executeRuns?: boolean | 'live' } = {},
): ReplayResult {
  // true = fixture replay: recorded runs, simulated where missing.
  // false = live dry run: agent runs are printed, never run, so no completion is invented.
  // 'live' = agents really run: a completion appears only once the runner has reported it in `runs`.
  const executeRuns = opts.executeRuns ?? true
  const events: EngineEvent[] = []
  const climate: ClimatePoint[] = []
  const runStates: Record<string, RunState> = {}
  const open: OpenQuestion[] = []
  const pending: Record<string, EngineEvent> = {}
  let queue: Scheduled[] = []
  let smooth: number | null = null
  let holding = false
  let held: EngineEvent[] = []
  let lastNudge: string | null = null
  const ring1Starts: string[] = []
  let cost = 0
  let todoSeq = 0
  let qSeq = 0

  const trust = (c: ActionClass) => clampTrust(c, policy.trust[c])

  const emit = (e: EngineEvent) => {
    // Manners: anything that would reach the wrist waits while the climate is elevated. Ring 0 nudges go through.
    if (holding && e.bee && e.kind !== 'exhale.nudge') {
      const h = { ...e, held: true }
      held.push(h)
      events.push(h)
      return
    }
    events.push(e)
    if (e.todoId && e.kind === 'pr.proposed') pending[e.todoId] = e
  }

  const newTodo = () => `t${++todoSeq}`

  const flushApprovals = (upTo: string) => {
    for (const [todoId, p] of Object.entries(pending)) {
      const at = approvals[todoId]
      if (at && Date.parse(at) <= Date.parse(upTo) && Date.parse(at) >= Date.parse(p.at)) {
        delete pending[todoId]
        events.push({
          at, ring: 2, kind: 'pr.approved', runId: p.runId, todoId,
          text: `You ticked it. Opening the pull request for ${runStates[p.runId!]?.branch}.`,
          bee: `bee changed shows todo ${todoId} completed -> gh pr create --head ${runStates[p.runId!]?.branch}`,
        })
      }
    }
  }

  const finishRun = (rs: RunState, at: string, diffStat: string, simulated: boolean) => {
    rs.status = 'done'
    // Attention is the real cost of a wrong run. A run with no edits and no question never reaches the wrist.
    if (/no edits/.test(diffStat)) {
      events.push({
        at, ring: 1, kind: 'agent.binned', runId: rs.id,
        text: `Binned: ${rs.branch} produced nothing to review (${diffStat}). Logged, not sent.${simulated ? ' (simulated: no recorded run)' : ''}`,
      })
      return
    }
    emit({
      at, ring: 1, kind: 'agent.result', runId: rs.id, todoId: newTodo(),
      text: `Branch ready: ${rs.branch}. ${diffStat}.${simulated ? ' (simulated: no recorded run)' : ''}`,
      bee: `bee todos create --text "Branch ready: ${rs.branch}. ${diffStat}"`,
    })
    // A branch whose checks fail reaches the wrist as a result, never as a request to open a PR.
    if (trust('open_pr') !== 'shadow' && !/CHECKS FAIL/.test(diffStat)) {
      emit({
        at, ring: 2, kind: 'pr.proposed', runId: rs.id, todoId: newTodo(),
        text: `Open a pull request for ${rs.branch}? Waits for your tick.`,
        bee: `bee todos create --text "Open PR for ${rs.branch}? Tick to approve."`,
      })
    }
  }

  const drain = (upTo: string) => {
    queue.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    while (queue.length && Date.parse(queue[0].at) <= Date.parse(upTo)) {
      const s = queue.shift()!
      flushApprovals(s.at)
      const rs = runStates[s.runId]
      if (s.kind === 'run.done') {
        cost += rs.run.costUsd
        if (rs.run.question) {
          rs.status = 'asked'
          const q: OpenQuestion = { id: `q${++qSeq}`, runId: rs.id, text: rs.run.question, askedAt: s.at }
          open.push(q)
          emit({
            at: s.at, ring: 1, kind: 'agent.question', runId: rs.id, todoId: newTodo(),
            text: `Agent asks (${rs.branch}): ${rs.run.question}`,
            bee: `bee todos create --text "Agent asks: ${rs.run.question}"`,
          })
        } else {
          finishRun(rs, s.at, rs.run.diffStat ?? 'plan only, no edits', !rs.run.recorded)
        }
      } else {
        cost += rs.run.resume?.costUsd ?? 0.1
        finishRun(rs, s.at, rs.run.resume?.diffStat ?? 'edits made', !rs.run.resume)
      }
    }
    flushApprovals(upTo)
  }

  for (const w of windows) {
    if (untilIso && Date.parse(w.endedAt) > Date.parse(untilIso)) break
    drain(w.endedAt)
    const j = judgments[w.id]
    if (!j) continue
    const a = j.response.answers
    const at = w.endedAt
    const media = (a.media as NoulA).noul >= policy.thresholds.media
    const raw = (a.climate as ScoreA).score

    if (media) {
      climate.push({ at, windowId: w.id, raw, smooth, media: true, holding })
      emit({ at, windowId: w.id, kind: 'media.skipped', text: `Media playback (p ${(a.media as NoulA).noul.toFixed(2)}). Not acted on, not counted in the climate.` })
      continue
    }

    const wasHolding = holding
    smooth = smooth === null ? raw : policy.manners.alpha * raw + (1 - policy.manners.alpha) * smooth
    if (!holding && smooth >= policy.manners.holdAt) {
      holding = true
      events.push({ at, windowId: w.id, kind: 'manners.hold', text: `Climate ${smooth.toFixed(1)} of 4. Holding anything that would reach your wrist.` })
    } else if (holding && smooth < policy.manners.releaseBelow) {
      holding = false
      const n = held.length
      events.push({ at, windowId: w.id, kind: 'manners.release', text: `Climate back to ${smooth.toFixed(1)}. Delivering ${n} held item${n === 1 ? '' : 's'}.` })
      for (const h of held) emit({ ...h, at, held: false, text: `Delivered after hold: ${h.text}` })
      held = []
    }
    climate.push({ at, windowId: w.id, raw, smooth, media: false, holding })

    if (policy.exhale.enabled) {
      const perf = (a.performance as NoulA).noul >= policy.thresholds.performance
      const cooled = !lastNudge || minutesBetween(lastNudge, at) >= policy.exhale.cooldownMin
      const entering = holding && !wasHolding
      if ((perf || entering) && cooled) {
        lastNudge = at
        const text = perf
          ? 'Box breathing: in 4, hold 4, out 4, hold 4. Four rounds before you start.'
          : 'Physiological sigh, twice: two inhales through the nose, one long exhale through the mouth.'
        emit({ at, windowId: w.id, ring: 0, kind: 'exhale.nudge', text, todoId: newTodo(), bee: `bee todos create --text "${text}" --alarm-at ${at}` })
      } else if ((perf || entering) && !cooled) {
        events.push({ at, windowId: w.id, ring: 0, kind: 'exhale.skip', text: `Would nudge, but the last nudge was under ${policy.exhale.cooldownMin} min ago.` })
      }
    }

    const [intent, p] = top(a.intent as ChoiceA)
    const text = w.utterances.map((u) => u.text).join(' ')

    // An answer to an open question wins over the broad intent label: the reply that describes a payload also reads as a
    // task, and the specific judgment (which open question does this answer?) is the one to trust. Seen 25 Sep 2026.
    if (a.answer_to) {
      const [qid, qp] = top(a.answer_to as ChoiceA)
      const qi = open.findIndex((q) => q.id === qid)
      if (qi >= 0 && qp >= policy.thresholds.answer && minutesBetween(open[qi].askedAt, at) <= policy.answerWindowMin) {
        const q = open.splice(qi, 1)[0]
        const rs = runStates[q.runId]
        rs.status = 'resumed'
        events.push({
          at, windowId: w.id, ring: 1, kind: 'agent.resumed', runId: rs.id,
          text: `Heard an answer to "${q.text}" (p ${qp.toFixed(2)}). Resuming the agent with what you said.`,
          bee: `claude -p --resume <session> --permission-mode acceptEdits "${text.replace(/"/g, "'")}"`,
        })
        if (executeRuns !== 'live' || rs.run.resume) queue.push({ at: addMs(at, rs.run.resume?.durationMs ?? 30000), kind: 'resume.done', runId: rs.id })
        continue
      }
    }

    if (intent === 'task' && p >= policy.thresholds.task) {
      const [line] = top(a.task_line as ChoiceA)
      const idx = line.startsWith('u') ? Number(line.slice(1)) : -1
      const task = idx >= 0 && w.utterances[idx] ? w.utterances[idx].text : text
      // A reply to an agent ("five attempts, go ahead") is not a new task. Judgments stored before this question existed pass.
      const selfContained = a.task_self_contained ? (a.task_self_contained as NoulA).noul : 1
      if (selfContained < policy.thresholds.selfContained) {
        events.push({ at, windowId: w.id, ring: 1, kind: 'agent.shadow', text: `Sounds like a reply or a fragment, not a new task (self-contained p ${selfContained.toFixed(2)}). Logged only: "${task}"` })
      } else if (policy.requireAddress && !text.toLowerCase().includes(policy.addressWord)) {
        events.push({ at, windowId: w.id, ring: 1, kind: 'agent.shadow', text: `Heard a task but it was not addressed to "${policy.addressWord}". Logged only: "${task}"` })
      } else if (ring1Starts.filter((t) => minutesBetween(t, at) < 60).length >= policy.ring1MaxPerHour) {
        events.push({ at, windowId: w.id, ring: 1, kind: 'agent.capped', text: `Ring 1 cap reached (${policy.ring1MaxPerHour} runs per hour). Logged only: "${task}"` })
      } else if (trust('agent') === 'shadow') {
        events.push({ at, windowId: w.id, ring: 1, kind: 'agent.shadow', text: `Shadow mode: would start an agent on "${task}".` })
      } else {
        if (!executeRuns && !runs[w.id]) {
          ring1Starts.push(at)
          events.push({
            at, windowId: w.id, ring: 1, kind: 'agent.started', task,
            text: `Task heard (p ${p.toFixed(2)}): "${task}". Not executed: run live mode with --execute to start it.`,
            bee: `git worktree add ../wt-rf-<repo>-${slug(task)}-<id> -b agent/${slug(task)}-<id> && claude -p --tools Read,Grep,Glob --output-format json "<plan prompt: ${task.replace(/"/g, "'")}>"`,
          })
          continue
        }
        const recorded = runs[w.id]
        const live = executeRuns === 'live'
        const run: AgentRun = recorded ?? {
          taskWindowId: w.id, task, mode: 'plan', branch: `agent/${slug(task)}`, durationMs: live ? 0 : 80000, costUsd: live ? 0 : 0.5,
          model: live ? 'running' : 'simulated', summary: live ? 'Running.' : 'No recorded run for this task.', recorded: live,
        }
        const id = `r${Object.keys(runStates).length + 1}`
        runStates[id] = { id, windowId: w.id, task, branch: run.branch, run, status: 'running' }
        ring1Starts.push(at)
        events.push({
          at, windowId: w.id, ring: 1, kind: 'agent.started', task, runId: id,
          text: `Task heard (p ${p.toFixed(2)}): "${task}". Agent started in ${live && !recorded ? 'its own worktree' : `a worktree on ${run.branch}`}.`,
          bee: `git worktree add ../wt-${slug(task)} -b ${run.branch} && claude -p --permission-mode plan --output-format json "${task.replace(/"/g, "'")}"`,
        })
        if (!live || recorded) queue.push({ at: addMs(at, run.durationMs), kind: 'run.done', runId: id })
      }
    } else if (intent === 'note' && p >= policy.thresholds.note) {
      const line = w.chunkText ?? text
      events.push({ at, windowId: w.id, ring: 0, kind: 'note.saved', text: `Noted, not acted on: ${line}`, bee: `append to intent.md: "- ${at.slice(0, 16)}Z ${line}"` })
    }
  }

  drain(untilIso ?? '9999-12-31T00:00:00.000Z')
  return { events, climate, openQuestions: open, pendingTodos: Object.values(pending), costUsd: cost }
}

// Open questions at a moment, for building the next judge request. Same code path as the replay.
export function openQuestionsAt(
  windows: Window[], judgments: Record<string, Judgment>, runs: Record<string, AgentRun>, policy: Policy, iso: string,
  opts: { executeRuns?: boolean | 'live' } = {},
): OpenQuestion[] {
  const before = windows.filter((w) => Date.parse(w.endedAt) < Date.parse(iso))
  return replay(before, judgments, runs, policy, {}, iso, opts).openQuestions
}
