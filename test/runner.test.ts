// Ring 1 and ring 2 with a fake `claude` on PATH: real git, real worktrees, real checks, no model.
//   npm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunner, BudgetExceeded } from '../src/runner.ts'

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
  Object.assign(process.env, { FAKE_PLAN: 'ready', FAKE_EDIT: 'good', FAKE_REPAIR: 'fix', FAKE_LOG: log })
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

test('two tasks run one at a time', async () => {
  const rf = runner()
  const both = Promise.all([rf.start('L001', 'Add a retry.', []), rf.start('L002', 'Add a timeout.', [])])
  assert.equal(rf.busy(), true)
  const [a, b] = await both
  assert.notEqual(a.branch, b.branch)
  assert.equal(rf.busy(), false)
})
