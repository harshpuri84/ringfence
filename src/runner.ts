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
  baseHead: string
  targetRepo?: string
  reviewedTree?: string
  publishCommit?: string // retained when a push fails, so retrying cannot publish unrelated commits
}

const READ_ONLY = ['Read', 'Grep', 'Glob']
const FILE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write']

export class BudgetExceeded extends Error {}

// Match the whole URL: a hostname ending in "github.com" is not necessarily GitHub.
export const githubRepo = (url: string): string | undefined =>
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1]

// The checks run code the agent wrote, as you. They get your environment without its keys and tokens.
// Files you can read, they can read: point Ringfence at repos you would let a contractor run tests on.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION/i
const SECRET_PREFIX = /^(GH|GITHUB|AWS|AZURE|GOOGLE|ANTHROPIC|OPENAI|TYPESAFE|AI_GATEWAY|VERCEL|NPM)_/
export function checkEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_NAME.test(k) && !SECRET_PREFIX.test(k)))
}

export function createRunner(cfg: RunnerConfig) {
  if (!Number.isFinite(cfg.maxUsdPerDay) || cfg.maxUsdPerDay < 0) throw new Error('maxUsdPerDay must be finite and non-negative')
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
    if (spentToday() >= cfg.maxUsdPerDay) throw new BudgetExceeded(`daily agent budget of US$${cfg.maxUsdPerDay} reached`)
    const args = ['-p', '--output-format', 'json', '--model', cfg.model, '--tools', tools.join(','),
      '--permission-mode', tools.includes('Edit') ? 'acceptEdits' : 'default',
      // --restricted ignores settings files, so hooks the agent writes into the target repo's .claude/ never run.
      '--restricted', '--strict-mcp-config', ...(resume ? ['--resume', resume] : []), prompt]
    const t0 = Date.now()
    return new Promise((resolve, reject) => {
      const p = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = ''
      const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`agent timed out after ${cfg.timeoutMs / 60000} min`)) }, cfg.timeoutMs)
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', (e) => { clearTimeout(timer); reject(new Error(`could not start claude: ${e.message}`)) })
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
  const targetRepo = (cwd: string) => {
    try { return githubRepo(git(cwd, 'remote', 'get-url', 'origin')) } catch { return undefined }
  }

  // Ringfence runs the repo's checks itself: the agent has no shell.
  function runChecks(wt: string): { ok: boolean; output: string } | null {
    if (!cfg.checkCmd) return null
    try {
      execFileSync('sh', ['-c', cfg.checkCmd], { cwd: wt, env: checkEnv(), stdio: ['ignore', 'pipe', 'pipe'], timeout: cfg.timeoutMs, maxBuffer: 16 * 1024 * 1024 })
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
    if (!git(r.worktree, 'diff', '--cached', '--shortstat')) return 'no edits'
    r.reviewedTree = git(r.worktree, 'write-tree')
    const verdict = check ? (check.ok ? 'checks pass, ' : 'CHECKS FAIL, ') : 'CHECKS NOT RUN, '
    return `${verdict}${git(r.worktree, 'diff', '--cached', '--shortstat')}, not committed`
  }

  const questionOf = (text: string) => /^\s*QUESTION:\s*(.+)$/m.exec(text)?.[1]?.trim()

  const reviewOf = (r: RunRecord): AgentRun['review'] => {
    if (!r.reviewedTree) return undefined
    return { repo: r.targetRepo ?? 'local repository', files: git(r.worktree, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean), tree: r.reviewedTree }
  }

  const toAgentRun = (r: RunRecord, plan: Pass): AgentRun => ({
    taskWindowId: r.windowId, task: r.task, mode: 'plan', branch: r.branch,
    durationMs: Date.now() - Date.parse(r.startedAt), costUsd: r.costUsd,
    model: plan.model, question: r.question, diffStat: r.diffStat, summary: plan.text.slice(0, 300), recorded: true, review: reviewOf(r),
  })

  return {
    idle: () => queue.then(() => undefined),
    busy: () => inFlight > 0,
    spentToday,

    // Plans; if the plan asks nothing, implements. Resolves when the agent stops.
    start(windowId: string, task: string, context: string[], facts: string[] = []): Promise<AgentRun> {
      return serial(async () => {
        if (spentToday() >= cfg.maxUsdPerDay) throw new BudgetExceeded(`daily agent budget of US$${cfg.maxUsdPerDay} reached`)
        const name = `task-${Date.now().toString(36)}`
        const branch = `agent/${name}`
        const worktree = join(cfg.worktreeRoot ?? join(homedir(), '.ringfence', 'worktrees'), `${basename(cfg.repo)}-${name}`)
        mkdirSync(dirname(worktree), { recursive: true })
        git(cfg.repo, 'worktree', 'add', '-b', branch, worktree)
        const r: RunRecord = { windowId, task, branch, worktree, baseHead: git(worktree, 'rev-parse', 'HEAD'), targetRepo: targetRepo(worktree), status: 'planning', startedAt: new Date().toISOString(), costUsd: 0 }
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
          return toAgentRun(r, plan)
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
        if (!r?.sessionId || r.status !== 'asked') throw new Error(`no waiting agent session for ${windowId}`)
        r.status = 'editing'
        save()
        try {
          const started = Date.now()
          const beforeCost = r.costUsd
          const edit = await claude(r.worktree, FILE_TOOLS,
            `The person answered out loud: "${answer}". Implement the plan with that answer. Keep the change small. Do not commit.`, r.sessionId)
          r.costUsd += edit.costUsd
          r.said = [...(r.said ?? []), edit.text.slice(-1500)]
          r.diffStat = await finish(r)
          r.status = 'done'
          save()
          return { durationMs: Date.now() - started, costUsd: r.costUsd - beforeCost, model: edit.model, diffStat: r.diffStat, review: reviewOf(r) }
        } catch (e) {
          r.status = 'failed'
          r.error = (e as Error).message
          save()
          throw e
        }
      })
    },

    // Ring 2. Called only after the person ticked the request.
    // The PR opens on the repo `origin` points at (your fork), never upstream: inside a fork, `gh pr create`
    // would otherwise target the parent repo. Opening a PR upstream stays a deliberate human step.
    openPr(windowId: string): string {
      const r = state[byWindow[windowId]]
      if (!r) throw new Error(`no run for ${windowId}`)
      if (r.pr?.startsWith('https://github.com/')) return r.pr
      const refuse = (why: string) => { r.pr = `refused, nothing pushed: ${why}`; save(); return r.pr }
      if (inFlight || r.status !== 'done') return refuse('the agent has not finished')
      let remote = ''
      try { remote = git(r.worktree, 'remote', 'get-url', 'origin') } catch { /* no remote */ }
      const repo = githubRepo(remote)
      const base = cfg.prBase ?? 'main'
      // Speech and Bee summaries stay out of public PR titles and commit messages.
      const title = `Ringfence: ${r.branch}`
      const body = 'Started from a spoken task via Ringfence. Planned with read-only tools, built with file tools only, opened after a tick.'
      // Display argv, never a copy-pastable shell string containing speech or paths.
      const cmds = [
        ...(cfg.checkCmd ? [['sh', '-c', cfg.checkCmd]] : []),
        ['git', '-C', r.worktree, 'commit', '-m', title],
        ['git', '-C', r.worktree, 'push', remote, `HEAD:refs/heads/${r.branch}`],
        ['gh', 'pr', 'create', '--repo', repo ?? '<origin>', '--base', base, '--head', r.branch, '--title', title],
      ]
      if (cfg.prDryRun || !repo) {
        r.pr = `dry run${repo ? '' : ' (no GitHub origin remote)'}: ${JSON.stringify(cmds)}`
        save()
        return r.pr
      }
      if (!cfg.checkCmd || !r.diffStat?.startsWith('checks pass, ') || !r.reviewedTree)
        return refuse('successful configured checks are required')
      if (repo !== r.targetRepo) return refuse('the target repository changed after the task started')
      const pushUrls = git(r.worktree, 'remote', 'get-url', '--push', '--all', 'origin').split('\n')
      if (pushUrls.length !== 1 || githubRepo(pushUrls[0]) !== repo)
        return refuse('origin fetch and push must name the same GitHub fork')
      // Ring 2 opens pull requests on your own fork only.
      let fork = ''
      try { fork = execFileSync('gh', ['api', `repos/${repo}`, '--jq', '.fork'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim() } catch { /* unknown counts as not a fork */ }
      if (fork !== 'true') return refuse(`${repo} is not a fork`)
      // A workflow or a Claude setting in the branch could run code on GitHub or in Claude. That needs a person.
      const unchanged = () =>
        git(r.worktree, 'branch', '--show-current') === r.branch &&
        git(r.worktree, 'rev-parse', 'HEAD') === (r.publishCommit ?? r.baseHead) &&
        git(r.worktree, 'write-tree') === r.reviewedTree &&
        !git(r.worktree, 'diff', '--name-only', '-z') &&
        !git(r.worktree, 'ls-files', '--others', '--exclude-standard', '-z')
      // Check the entire PR diff, including commits already present when the task started.
      const mergeBase = git(r.worktree, 'merge-base', base, 'HEAD')
      if (git(r.worktree, 'diff', '--cached', '--no-renames', '--name-only', '-z', mergeBase).split('\0')
        .some((f) => /^(\.(github|claude|husky)(\/|$)|\.gitmodules$|\.env(?:$|\.))/.test(f)))
        return refuse('the branch changes .github/, .claude/, hooks, submodules or environment files; review it by hand')
      if (!unchanged()) return refuse('the branch changed after the result; run a new review')
      const check = runChecks(r.worktree)!
      if (!check.ok) { r.pr = `checks failed, nothing committed: ${check.output}`; save(); return r.pr }
      // Checks may themselves edit or stage files. The tick covers exactly the completed result.
      if (!unchanged()) return refuse('checks changed the branch; run a new review')
      // Commit once. A retry after a failed push finds nothing staged and goes straight to the push.
      if (!r.publishCommit) {
        git(r.worktree, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', title)
        r.publishCommit = git(r.worktree, 'rev-parse', 'HEAD')
        save()
      }
      // Use the verified URL and an explicit destination ref; Git's pushurl/push configuration cannot redirect it.
      execFileSync('git', ['-C', r.worktree, '-c', 'core.hooksPath=/dev/null', 'push', remote, `${r.publishCommit}:refs/heads/${r.branch}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
      r.pr = execFileSync('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', r.branch, '--title', title, '--body', body],
        { cwd: r.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim()
      save()
      return r.pr
    },
  }
}
