// Ring 1: a headless coding agent on its own branch in its own git worktree.
// Worktrees live in a path without spaces: given a folder like "My Projects", the model wrote "My\\ Projects" into
// Read calls, which then fell outside the project and were denied (seen 25 Sep 2026).
// Pass 1 plans with read-only tools and may end with a QUESTION. Pass 2 edits with file tools only: no shell,
// so no installs, no network, no scripts. Ring 2 (commit, push, PR) runs only through openPr, after a tick.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { AgentRun } from './engine/types.ts'

export interface RunnerConfig {
  repo: string // target repo
  worktreeRoot?: string // default ~/.ringfence/worktrees
  stateFile: string
  model: string
  maxUsdPerDay: number
  timeoutMs: number
  prDryRun: boolean
  checkCmd?: string // run in the worktree before any commit, e.g. the target repo's typecheck and build
  prBase?: string // default main
}

interface Pass { durationMs: number; costUsd: number; model: string; sessionId: string; text: string; turns: number; denials: unknown[] }
interface RunRecord {
  windowId: string
  task: string
  branch: string
  worktree: string
  sessionId?: string
  status: 'planning' | 'asked' | 'editing' | 'done' | 'failed'
  startedAt: string
  costUsd: number
  question?: string
  diffStat?: string
  error?: string
  pr?: string
  said?: string[] // the agent's final message from each pass, for the audit trail
}

const READ_ONLY = ['Read', 'Grep', 'Glob']
const FILE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write']

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((x) => x.length > 2).slice(0, 3).join('-') || 'task'

export class BudgetExceeded extends Error {}

export function createRunner(cfg: RunnerConfig) {
  mkdirSync(dirname(cfg.stateFile), { recursive: true })
  // Audit trail of every run across restarts, keyed by a unique run key. Window ids restart at L001 each process,
  // so this process keeps its own window -> run key index. A restarted process does not pick old runs back up.
  const state: Record<string, RunRecord> = existsSync(cfg.stateFile) ? JSON.parse(readFileSync(cfg.stateFile, 'utf8')) : {}
  const byWindow: Record<string, string> = {}
  const save = () => writeFileSync(cfg.stateFile, JSON.stringify(state, null, 1) + '\n')
  let queue: Promise<unknown> = Promise.resolve()
  let inFlight = 0
  // One agent at a time: every pass waits its turn.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    inFlight++
    const p = queue.then(fn).finally(() => inFlight--)
    queue = p.catch(() => undefined)
    return p
  }

  const spentToday = () => {
    const day = new Date().toISOString().slice(0, 10)
    return Object.values(state).filter((r) => r.startedAt.startsWith(day)).reduce((s, r) => s + r.costUsd, 0)
  }

  function claude(cwd: string, tools: string[], prompt: string, resume?: string): Promise<Pass> {
    const args = ['-p', '--output-format', 'json', '--model', cfg.model, '--tools', tools.join(','),
      '--permission-mode', tools.includes('Edit') ? 'acceptEdits' : 'default',
      '--setting-sources', 'project', '--strict-mcp-config', ...(resume ? ['--resume', resume] : []), prompt]
    const t0 = Date.now()
    return new Promise((resolve, reject) => {
      const p = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = ''
      const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`agent timed out after ${cfg.timeoutMs / 60000} min`)) }, cfg.timeoutMs)
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))
        try {
          const j = JSON.parse(out)
          resolve({ durationMs: Date.now() - t0, costUsd: j.total_cost_usd ?? 0, model: Object.keys(j.modelUsage ?? {}).join('+') || cfg.model, sessionId: j.session_id, text: String(j.result ?? ''), turns: j.num_turns ?? 0, denials: j.permission_denials ?? [] })
        } catch (e) { reject(new Error(`unreadable agent output: ${(e as Error).message}`)) }
      })
    })
  }

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  // Ringfence runs the repo's checks itself: the agent has no shell.
  function runChecks(wt: string): { ok: boolean; output: string } | null {
    if (!cfg.checkCmd) return null
    try {
      execFileSync('sh', ['-c', cfg.checkCmd], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'], timeout: cfg.timeoutMs })
      return { ok: true, output: '' }
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer }
      return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}`.slice(-2000) }
    }
  }

  // After an edit pass: check, give the agent one chance to fix a failure, check again. The verdict leads the result.
  async function finish(r: RunRecord): Promise<string> {
    git(r.worktree, 'add', '-A')
    if (!git(r.worktree, 'diff', '--cached', '--shortstat')) return 'no edits'
    let check = runChecks(r.worktree)
    if (check && !check.ok) {
      const fix = await claude(r.worktree, FILE_TOOLS,
        `The repository's checks failed. Their output:\n${check.output}\nFix the cause. Keep the change small. Do not commit.`, r.sessionId)
      r.costUsd += fix.costUsd
      r.said = [...(r.said ?? []), `[repair pass] ${fix.text.slice(-800)}`]
      check = runChecks(r.worktree)
    }
    git(r.worktree, 'add', '-A') // checks may write build output; stage only what git does not ignore
    const verdict = check ? (check.ok ? 'checks pass, ' : 'CHECKS FAIL, ') : ''
    return `${verdict}${git(r.worktree, 'diff', '--cached', '--shortstat')}, not committed`
  }

  const questionOf = (text: string) => /^\s*QUESTION:\s*(.+)$/m.exec(text)?.[1]?.trim()

  const toAgentRun = (r: RunRecord, plan: Pass, edit?: Pass): AgentRun => ({
    taskWindowId: r.windowId, task: r.task, mode: 'plan', branch: r.branch,
    durationMs: plan.durationMs + (edit?.durationMs ?? 0), costUsd: plan.costUsd + (edit?.costUsd ?? 0),
    model: plan.model, question: r.question, diffStat: r.diffStat, summary: plan.text.slice(0, 300), recorded: true,
  })

  return {
    idle: () => queue.then(() => undefined),
    busy: () => inFlight > 0,
    spentToday,

    // Plans; if the plan asks nothing, implements. Resolves when the agent stops.
    start(windowId: string, task: string, context: string[], facts: string[] = []): Promise<AgentRun> {
      return serial(async () => {
        if (spentToday() >= cfg.maxUsdPerDay) throw new BudgetExceeded(`daily agent budget of US$${cfg.maxUsdPerDay} reached`)
        const name = `${slug(task)}-${Date.now().toString(36)}`
        const branch = `agent/${name}`
        const worktree = join(cfg.worktreeRoot ?? join(homedir(), '.ringfence', 'worktrees'), `${basename(cfg.repo)}-${name}`)
        mkdirSync(dirname(worktree), { recursive: true })
        git(cfg.repo, 'worktree', 'add', '-b', branch, worktree)
        const r: RunRecord = { windowId, task, branch, worktree, status: 'planning', startedAt: new Date().toISOString(), costUsd: 0 }
        const key = `${r.startedAt}-${windowId}`
        state[key] = r
        byWindow[windowId] = key
        save()
        const prompt = [
          `A person said this out loud to their wearable while away from the keyboard: "${task}"`,
          context.length ? `What they were talking about in the minutes before, as summarised by Bee:\n- ${context.join('\n- ')}` : '',
          facts.length ? `Facts Ringfence has observed on the Bee stream (values redacted). Use them; do not invent others:\n- ${facts.join('\n- ')}` : '',
          'Read the repository and plan the change. Use paths relative to the current directory. Do not edit anything in this pass.',
          'Do not guess facts about external APIs or data formats. If the repository and the facts above do not settle something, ask.',
          'If one decision from the person would change the plan, end with a single line: QUESTION: <the question>.',
          'Otherwise end with a single line: READY.',
        ].filter(Boolean).join('\n\n')
        try {
          const plan = await claude(worktree, READ_ONLY, prompt)
          r.sessionId = plan.sessionId
          r.costUsd += plan.costUsd
          r.said = [`[${plan.turns} turns, ${plan.denials.length} denials ${JSON.stringify(plan.denials).slice(0, 300)}] ${plan.text.slice(-1500)}`]
          r.question = questionOf(plan.text)
          // Denials only matter when they left the agent nothing to read (seen: 3 turns, 2 denials). A stray denied read of
          // a path outside the worktree, such as Claude Code's memory folder, does not.
          if (plan.denials.length && plan.turns - plan.denials.length < 3 && !r.question)
            throw new Error(`the agent was denied ${plan.denials.length} tool calls and could not plan`)
          if (r.question) {
            r.status = 'asked'
            save()
            return toAgentRun(r, plan)
          }
          r.status = 'editing'
          save()
          const edit = await claude(worktree, FILE_TOOLS, 'Implement the plan now. Keep the change small. Do not commit.', r.sessionId)
          r.costUsd += edit.costUsd
          r.said.push(edit.text.slice(-1500))
          r.diffStat = await finish(r)
          r.status = 'done'
          save()
          return toAgentRun(r, plan, edit)
        } catch (e) {
          r.status = 'failed'
          r.error = (e as Error).message
          save()
          throw e
        }
      })
    },

    // The person's spoken answer resumes the same session with file tools.
    resume(windowId: string, answer: string): Promise<NonNullable<AgentRun['resume']>> {
      return serial(async () => {
        const r = state[byWindow[windowId]]
        if (!r?.sessionId) throw new Error(`no agent session for ${windowId}`)
        r.status = 'editing'
        save()
        const edit = await claude(r.worktree, FILE_TOOLS,
          `The person answered out loud: "${answer}". Implement the plan with that answer. Keep the change small. Do not commit.`, r.sessionId)
        r.costUsd += edit.costUsd
        r.said = [...(r.said ?? []), edit.text.slice(-1500)]
        r.diffStat = await finish(r)
        r.status = 'done'
        save()
        return { durationMs: edit.durationMs, costUsd: edit.costUsd, model: edit.model, diffStat: r.diffStat }
      })
    },

    // Ring 2. Called only after the person ticked the request.
    // The PR opens on the repo `origin` points at (your fork), never upstream: inside a fork, `gh pr create`
    // would otherwise target the parent repo. Opening a PR upstream stays a deliberate human step.
    openPr(windowId: string): string {
      const r = state[byWindow[windowId]]
      if (!r) throw new Error(`no run for ${windowId}`)
      let remote = ''
      try { remote = git(r.worktree, 'remote', 'get-url', 'origin') } catch { /* no remote */ }
      const repo = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1]
      const base = cfg.prBase ?? 'main'
      const title = r.task
      const body = 'Started from a spoken task via Ringfence. Planned with read-only tools, built with file tools only, opened after a tick.'
      const cmds = [
        ...(cfg.checkCmd ? [`(cd ${r.worktree} && ${cfg.checkCmd})`] : []),
        `git -C ${r.worktree} commit -m ${JSON.stringify(title)}`,
        `git -C ${r.worktree} push -u origin ${r.branch}`,
        `gh pr create --repo ${repo ?? '<origin>'} --base ${base} --head ${r.branch} --title ${JSON.stringify(title)}`,
      ]
      if (cfg.prDryRun || !repo) {
        r.pr = `dry run${repo ? '' : ' (no GitHub origin remote)'}: ${cmds.join(' && ')}`
        save()
        return r.pr
      }
      if (cfg.checkCmd) {
        try { execFileSync('sh', ['-c', cfg.checkCmd], { cwd: r.worktree, stdio: ['ignore', 'pipe', 'pipe'] }) }
        catch (e) { r.pr = `checks failed, nothing committed: ${(e as Error).message.slice(0, 300)}`; save(); return r.pr }
      }
      git(r.worktree, 'commit', '-m', title)
      git(r.worktree, 'push', '-u', 'origin', r.branch)
      r.pr = execFileSync('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', r.branch, '--title', title, '--body', body],
        { cwd: r.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      save()
      return r.pr
    },
  }
}
