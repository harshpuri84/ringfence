// Ring 1 and ring 2 with a fake `claude` and a fake `gh` on PATH: real git, real worktrees, real checks, no model, no network.
//   npm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunner, BudgetExceeded, checkEnv, githubRepo } from '../src/runner.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()

// One fake `claude` for the whole file, first on PATH.
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const bin = mkdtempSync(join(tmpdir(), 'rf-bin-'))
copyFileSync(new URL('./fake-claude.js', import.meta.url), join(bin, 'claude'))
chmodSync(join(bin, 'claude'), 0o755)
// Only transport is faked: assert that the verified GitHub URL and explicit branch ref reach Git.
writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const i = args.indexOf('push');
if (i >= 0 && process.env.FAKE_PUSH_DESTINATION) {
  if (args[i + 1] !== 'https://github.com/someone/bee-cli.git') process.exit(99);
  if (!/^[a-f0-9]+:refs\\/heads\\/agent\\//.test(args[i + 2])) process.exit(98);
  args[i + 1] = process.env.FAKE_PUSH_DESTINATION;
}
try { process.stdout.write(execFileSync(${JSON.stringify(realGit)}, args, { encoding: 'utf8' })); }
catch (e) { process.exit(e.status || 1); }
`)
chmodSync(join(bin, 'git'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`

let base = ''
let repo = ''
let log = ''
beforeEach(() => {
  delete process.env.FAKE_PUSH_DESTINATION
  base = mkdtempSync(join(tmpdir(), 'rf-test-'))
  repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/someone/bee-cli.git')
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
  assert.equal(r.review?.repo, 'someone/bee-cli')
  assert.deepEqual(r.review?.files, ['stream.js'])
  const [plan, edit] = calls()
  assert.equal(r.review?.tree, git(plan.cwd, 'write-tree'))
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
  assert.equal(res.review?.repo, 'someone/bee-cli')
  assert.deepEqual(res.review?.files, ['stream.js'])
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
  const before = git(wt, 'rev-list', '--count', 'HEAD')
  const out = rf.openPr('L001')
  assert.match(out, /^dry run: /)
  assert.ok(out.includes('["gh","pr","create","--repo","someone/bee-cli","--base","main"'))
  assert.equal(git(wt, 'rev-list', '--count', 'HEAD'), before)
})

test('ring 2 without a GitHub origin stays a dry run even when dry run is off', async () => {
  git(repo, 'remote', 'remove', 'origin')
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
  process.env.FAKE_PUSH_DESTINATION = bare
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
  assert.ok(git(bare, 'log', '--oneline', branch).includes(`Ringfence: ${branch}`))
  assert.match(readFileSync(ghLog, 'utf8'), new RegExp(`^pr create --repo someone/bee-cli --base main --head ${branch} --title Ringfence: ${branch}`))
  assert.equal(git(repo, 'rev-parse', 'main'), head, 'main is untouched')
})

test('ring 2 refuses unstaged edits made after the result', async () => {
  const { bare, ghLog } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  writeFileSync(join(wt, 'stream.js'), 'async function connect( {\n')
  assert.match(rf.openPr('L001'), /branch changed after the result/)
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
  process.env.FAKE_PUSH_DESTINATION = bare
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

test('GitHub remote parsing rejects lookalike hosts and extra URL components', () => {
  for (const url of ['https://evilgithub.com/owner/repo.git', 'https://github.com/owner/repo/extra', 'https://github.com/owner/repo?x=1'])
    assert.equal(githubRepo(url), undefined)
  for (const url of ['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo'])
    assert.equal(githubRepo(url), 'owner/repo')
})

test('ring 2 refuses a different push destination before committing', async () => {
  const { bare, ghLog } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  git(wt, 'remote', 'set-url', '--push', 'origin', 'https://github.com/someone/upstream.git')
  const head = git(wt, 'rev-parse', 'HEAD')
  assert.match(rf.openPr('L001'), /fetch and push must name the same/)
  assert.equal(git(wt, 'rev-parse', 'HEAD'), head)
  assert.ok(!existsSync(ghLog))
})

test('ring 2 refuses multiple push URLs', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  git(wt, 'remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/someone/bee-cli.git')
  git(wt, 'remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/someone/elsewhere.git')
  assert.match(rf.openPr('L001'), /fetch and push must name the same/)
})

test('ring 2 inspects protected files already committed on the starting branch', async () => {
  const { bare } = fakeFork()
  git(repo, 'switch', '-c', 'unreviewed')
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'on: push\n')
  git(repo, 'add', '-A')
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'unreviewed workflow')
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  pointAtFork(calls()[0].cwd, bare)
  assert.match(rf.openPr('L001'), /branch changes .github/)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('checks cannot add protected files after the tick', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false, checkCmd: 'if test -f tick-marker; then mkdir -p .github/workflows; echo bad > .github/workflows/ci.yml; git add .github; fi; node --check stream.js' })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  // A marker ignored by Git lets the check behave differently at tick time.
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'tick-marker\n')
  writeFileSync(join(wt, 'tick-marker'), '')
  assert.match(rf.openPr('L001'), /checks changed the branch/)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('checks failing at tick time do not commit or push', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false, checkCmd: 'test ! -f tick-marker && node --check stream.js' })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'tick-marker\n')
  writeFileSync(join(wt, 'tick-marker'), '')
  assert.match(rf.openPr('L001'), /^checks failed, nothing committed/)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('an unchecked result never publishes', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false, checkCmd: undefined })
  const result = await rf.start('L001', 'Add a retry.', [])
  pointAtFork(calls()[0].cwd, bare)
  assert.match(result.diffStat!, /^CHECKS NOT RUN/)
  assert.match(rf.openPr('L001'), /successful configured checks are required/)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('a retry refuses commits added after a failed push', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, join(base, 'missing.git'))
  assert.throws(() => rf.openPr('L001'))
  writeFileSync(join(wt, 'extra.txt'), 'unreviewed')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-qm', 'unreviewed')
  process.env.FAKE_PUSH_DESTINATION = bare
  assert.match(rf.openPr('L001'), /branch changed after the result/)
  assert.equal(git(bare, 'branch', '--list'), '')
})

test('a successful PR is returned on retry without creating another', async () => {
  const { bare, ghLog } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  pointAtFork(calls()[0].cwd, bare)
  assert.equal(rf.openPr('L001'), rf.openPr('L001'))
  assert.equal(readFileSync(ghLog, 'utf8').trim().split('\n').length, 1)
})

test('the daily budget is checked again before resuming an agent', async () => {
  process.env.FAKE_PLAN = 'ask'
  const rf = runner({ maxUsdPerDay: 0.01 })
  await rf.start('L001', 'Add a retry.', [])
  await assert.rejects(rf.resume('L001', 'Five.'), BudgetExceeded)
  assert.equal(calls().length, 1)
  const state = JSON.parse(readFileSync(join(base, 'state', 'runs.json'), 'utf8'))
  assert.equal(Object.values(state)[0] && (Object.values(state)[0] as { status: string }).status, 'failed')
})


test('the approved task cannot be redirected to another fork', async () => {
  const { bare } = fakeFork()
  const rf = runner({ prDryRun: false })
  await rf.start('L001', 'Add a retry.', [])
  const wt = calls()[0].cwd
  pointAtFork(wt, bare)
  git(wt, 'remote', 'set-url', 'origin', 'https://github.com/someone/different-fork.git')
  assert.match(rf.openPr('L001'), /target repository changed/)
  assert.equal(git(bare, 'branch', '--list'), '')
})
