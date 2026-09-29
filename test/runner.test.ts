// Ring 1 and ring 2 with a fake `claude` and a fake `gh` on PATH: real git, real worktrees, real checks, no model, no network.
//   npm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunner, BudgetExceeded, checkEnv } from '../src/runner.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()

// One fake `claude` for the whole file, first on PATH.
const bin = mkdtempSync(join(tmpdir(), 'rf-bin-'))
copyFileSync(new URL('./fake-claude.js', import.meta.url), join(bin, 'claude'))
chmodSync(join(bin, 'claude'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`

let base = ''
let repo = ''
let log = ''
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'rf-test-'))
  repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'stream.js'), 'async function connect(url) { return fetch(url) }\nmodule.exports = { connect }\n')
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  log = join(base, 'calls.jsonl')
  Object.assign(process.env, { FAKE_PLAN: 'ready', FAKE_EDIT: 'good', FAKE_REPAIR: 'fix', FAKE_LOG: log, FAKE_FORK: 'true' })
})

const runner = (over: Partial<Parameters<typeof createRunner>[0]> = {}) =>
  createRunner({
    repo, worktreeRoot: join(base, 'wt'), stateFile: join(base, 'state', 'runs.json'), model: 'haiku',
    maxUsdPerDay: 5, timeoutMs: 60_000, prDryRun: true, checkCmd: 'node --check stream.js', ...over,
  })
const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; cwd: string })
const toolsOf = (c: { args: string[] }) => c.args[c.args.indexOf('--tools') + 1]

test('plans read-only, builds with file tools only, and leaves the main repo untouched', async () => {
  const head = git(repo, 'rev-parse', 'HEAD')
  const r = await runner().start('L001', 'Add a retry to the stream client.', ['Speaker talks about the stream client.'])
  assert.match(r.diffStat!, /^checks pass, 1 file changed/)
  const [plan, edit] = calls()
  assert.equal(toolsOf(plan), 'Read,Grep,Glob')
  assert.ok(toolsOf(edit).includes('Edit') && !toolsOf(edit).includes('Bash'), 'no shell in the build pass')
  assert.ok(plan.args.at(-1)!.includes('Speaker talks about the stream client.'), 'Bee context reaches the prompt')
  assert.match(git(plan.cwd, 'branch', '--show-current'), /^agent\//)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(repo, 'status', '--porcelain'), '')
})

test('observed Bee event shapes reach the planning prompt', async () => {
  await runner().start('L001', 'Show new-utterance-chunks events.', [], ['Bee stream event "new-utterance-chunks" has this payload shape: {"chunks":[{"chunk_text":"<string>"}]}'])
  const prompt = calls()[0].args.at(-1)!
  assert.ok(prompt.includes('chunk_text'))
  assert.ok(prompt.includes('do not invent others'))
})

test('a question pauses the agent; the spoken answer resumes the same session', async () => {
  process.env.FAKE_PLAN = 'ask'
  const rf = runner()
  const r = await rf.start('L001', 'Add a retry to the stream client.', [])
  assert.equal(r.question, 'How many retries?')
  assert.equal(r.diffStat, undefined)
  const res = await rf.resume('L001', 'Five, and cap the delay at thirty seconds.')
  assert.match(res.diffStat, /^checks pass/)
  const resumeCall = calls().at(-1)!
  assert.equal(resumeCall.args[resumeCall.args.indexOf('--resume') + 1], 'fake-session-1')
  assert.ok(resumeCall.args.at(-1)!.includes('Five, and cap the delay'))
})

test('an agent that could read nothing fails loudly instead of building', async () => {
  process.env.FAKE_PLAN = 'deny'
  await assert.rejects(runner().start('L001', 'Add a retry.', []), /could not plan/)
  assert.equal(calls().length, 1, 'no build pass after a failed plan')
})

test('one stray denied read does not fail a plan that worked', async () => {
  process.env.FAKE_PLAN = 'stray-deny'
  const r = await runner().start('L001', 'Add a retry.', [])
  assert.match(r.diffStat!, /^checks pass/)
})

test('failing checks get one repair pass', async () => {
  process.env.FAKE_EDIT = 'broken'
  const r = await runner().start('L001', 'Add a retry.', [])
  assert.match(r.diffStat!, /^checks pass/)
  const last = calls().at(-1)!
  assert.ok(last.args.at(-1)!.includes('checks failed'), 'the repair prompt carries the check output')
})

test('checks that still fail after the repair are reported as CHECKS FAIL', async () => {
  Object.assign(process.env, { FAKE_EDIT: 'broken', FAKE_REPAIR: 'keep' })
  const r = await runner().start('L001', 'Add a retry.', [])
  assert.match(r.diffStat!, /^CHECKS FAIL/)
})

test('a build with no edits says so', async () => {
  process.env.FAKE_EDIT = 'none'
  const r = await runner().start('L001', 'Add a retry.', [])
  assert.equal(r.diffStat, 'no edits')
})

test('the daily budget stops new runs', async () => {
  await assert.rejects(runner({ maxUsdPerDay: 0 }).start('L001', 'Add a retry.', []), BudgetExceeded)
  assert.ok(!existsSync(log), 'no agent was called')
})

test('ring 2 in dry-run mode commits nothing and names the fork, never upstream', async () => {
  const rf = runner()
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  git(wt, 'remote', 'add', 'origin', 'https://github.com/someone/bee-cli.git')
  const before = git(wt, 'rev-list', '--count', 'HEAD')
  const out = rf.openPr('L001')
  assert.match(out, /^dry run: /)
  assert.match(out, /gh pr create --repo someone\/bee-cli --base main/)
  assert.equal(git(wt, 'rev-list', '--count', 'HEAD'), before)
})

test('ring 2 without a GitHub origin stays a dry run even when dry run is off', async () => {
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  assert.match(rf.openPr('L001'), /no GitHub origin remote/)
})

// Ring 2 for real, with no network: origin looks like GitHub for fetch, pushes go to a local bare repo, and `gh` is a fake.
function fakeFork() {
  const bare = join(base, 'fork.git')
  execFileSync('git', ['init', '-q', '--bare', bare])
  const ghLog = join(base, 'gh.log')
  // `gh api repos/<repo> --jq .fork` answers FAKE_FORK; everything else is logged and answers with a PR URL.
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nif [ "$1" = api ]; then echo "$FAKE_FORK"; exit 0; fi\necho "$@" >> "${ghLog}"\necho https://github.com/someone/bee-cli/pull/1\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  return { bare, ghLog }
}
function pointAtFork(wt: string, bare: string) {
  git(wt, 'remote', 'add', 'origin', 'https://github.com/someone/bee-cli.git')
  git(wt, 'remote', 'set-url', '--push', 'origin', bare)
  git(wt, 'config', 'user.email', 't@t')
  git(wt, 'config', 'user.name', 't')
}

test('ring 2 for real: reruns the checks, commits, pushes the branch and opens the PR on the fork', async () => {
  const { bare, ghLog } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  const head = git(repo, 'rev-parse', 'main')
  assert.equal(rf.openPr('L001'), 'https://github.com/someone/bee-cli/pull/1')
  const branch = git(wt, 'branch', '--show-current')
  assert.match(git(bare, 'log', '--oneline', branch), /Add a retry\./)
  assert.match(readFileSync(ghLog, 'utf8'), new RegExp(`^pr create --repo someone/bee-cli --base main --head ${branch} --title Add a retry\\.`))
  assert.equal(git(repo, 'rev-parse', 'main'), head, 'main is untouched')
})

test('ring 2 for real: checks that fail at tick time commit and push nothing', async () => {
  const { bare, ghLog } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  writeFileSync(join(wt, 'stream.js'), 'async function connect( {\n')
  assert.match(rf.openPr('L001'), /^checks failed, nothing committed/)
  assert.equal(git(bare, 'branch', '--list'), '')
  assert.ok(!existsSync(ghLog), 'gh was never called')
})

test('ring 2 refuses to push to a repo that is not a fork', async () => {
  const { bare, ghLog } = fakeFork()
  process.env.FAKE_FORK = 'false'
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  pointAtFork(calls()[0].cwd, bare)
  assert.match(rf.openPr('L001'), /^refused, nothing pushed: someone\/bee-cli is not a fork/)
  assert.equal(git(bare, 'branch', '--list'), '')
  assert.ok(!existsSync(ghLog))
})

test('ring 2 refuses a branch that changes .github/ and leaves it for a person', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  mkdirSync(join(wt, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(wt, '.github', 'workflows', 'ci.yml'), 'on: push\n')
  git(wt, 'add', '-A')
  assert.match(rf.openPr('L001'), /^refused, nothing pushed: the branch changes \.github\//)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('a push that fails can be retried without a second commit', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, join(base, 'missing.git'))
  assert.throws(() => rf.openPr('L001'))
  git(wt, 'remote', 'set-url', '--push', 'origin', bare)
  assert.equal(rf.openPr('L001'), 'https://github.com/someone/bee-cli/pull/1')
  assert.equal(git(wt, 'rev-list', '--count', 'main..HEAD'), '1')
})

test('the checks run without your keys and tokens, and the agent runs restricted', async () => {
  assert.deepEqual(Object.keys(checkEnv({ PATH: 'p', HOME: 'h', GH_TOKEN: 'x', ANTHROPIC_API_KEY: 'x', AI_GATEWAY_API_KEY: 'x', SSH_AUTH_SOCK: 'x' })), ['PATH', 'HOME'])
  process.env.RF_TEST_TOKEN = 'secret'
  try {
    const r = await runner({ checkCmd: 'test -z "$RF_TEST_TOKEN" && node --check stream.js' }).start('L001', 'Add a retry.', [])
    assert.match(r.diffStat!, /^checks pass/)
  } finally { delete process.env.RF_TEST_TOKEN }
  const args = calls()[0].args
  assert.ok(args.includes('--restricted') && !args.includes('--setting-sources'))
})

test('two tasks run one at a time', async () => {
  const rf = runner()
  const both = Promise.all([rf.start('L001', 'Add a retry.', []), rf.start('L002', 'Add a timeout.', [])])
  assert.equal(rf.busy(), true)
  const [a, b] = await both
  assert.notEqual(a.branch, b.branch)
  assert.equal(rf.busy(), false)
})
