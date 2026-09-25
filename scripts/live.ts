// Live mode: capture files -> windows -> judge -> engine -> effects.
// Ringfence does not open `bee stream` itself. A separate capture daemon owns the stream and writes
// raw events, one JSON object per line as `bee stream --types all --json` prints them, to *.jsonl in
// $BEE_CAPTURE_DIR (default ~/.bee-capture). Ringfence tails the newest file. Its own log goes to
// $BEE_CAPTURE_DIR/ringfence/, outside every git repo, because it holds your real speech.
//   node --env-file-if-exists=.env scripts/live.ts             # dry run: prints what it would do, writes nothing
//   node --env-file-if-exists=.env scripts/live.ts --effects   # also writes Bee todos (these can buzz your phone)
//   add --standin to judge with Claude Haiku when no TYPESAFE_API_KEY is set
//   add --execute --repo <path> to run ring-1 agents for real on that repo, in worktrees under ~/.ringfence/worktrees (or set RINGFENCE_REPO)
//   add --from fixtures/day.events.jsonl to replay a recorded stream instead (for testing); PRs are then always a dry run
//   add --auto-tick with --from to approve every PR request at once (testing only)
//   add --answer "<text>" with --from to speak that reply right after an agent asks (testing only; the judge still has to match it)
//   add --stay with --from to keep serving the dashboard after the file ends
// The dashboard follows along at http://localhost:5188/?live. This process serves its state on 127.0.0.1:5189,
// only to the dashboard's own origin, because the state holds real speech.
// Without --execute, agent runs are printed, not run. A PR needs --execute, --effects and your tick.
// Approvals: the stream never delivers todo events (tested 25 Sep 2026, by name and with --types all),
// so ticks are read from the `bee changed` changefeed, polled every 10 s.
import { appendFileSync, mkdirSync, createReadStream, existsSync, readdirSync, statSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { AgentRun, EngineEvent, Judgment, Utterance, Window } from '../src/engine/types.ts'
import { buildRequest } from '../src/engine/questions.ts'
import { openQuestionsAt, replay } from '../src/engine/engine.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { jev } from '../src/judge/jev.ts'
import { standin } from '../src/judge/standin.ts'
import { createTodo, changedSince } from '../src/bee.ts'
import { createRunner } from '../src/runner.ts'

const EFFECTS = process.argv.includes('--effects')
const STANDIN = process.argv.includes('--standin') || !process.env.TYPESAFE_API_KEY
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
const FROM = arg('--from')
const EXECUTE = process.argv.includes('--execute')
const AUTO_TICK = process.argv.includes('--auto-tick') && !!FROM
const TEST_ANSWER = FROM ? arg('--answer') : null
const spokenReplies: string[] = []
const STAY = process.argv.includes('--stay')
const UI_PORT = Number(process.env.RINGFENCE_UI_PORT ?? 5189)
const UI_ORIGINS = new Set((process.env.RINGFENCE_UI_ORIGIN ?? 'http://localhost:5188,http://127.0.0.1:5188').split(','))
const REPO = arg('--repo') ?? process.env.RINGFENCE_REPO
if (EXECUTE && !REPO) { console.error('--execute needs --repo <path> or RINGFENCE_REPO'); process.exit(1) }
const MODE = EXECUTE ? ('live' as const) : false
const FLUSH_MS = 180_000 // close a window if Bee sends no chunk event for 3 min
const CAPTURE_DIR = process.env.BEE_CAPTURE_DIR ?? join(homedir(), '.bee-capture')
const logDir = join(CAPTURE_DIR, 'ringfence')
mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, `live-${new Date().toISOString().slice(0, 10)}.jsonl`)
const notesFile = join(logDir, 'intent.md')
const log = (o: object) => appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
const runner = EXECUTE
  ? createRunner({
      repo: resolve(REPO!), stateFile: join(logDir, 'runs.json'), model: process.env.RINGFENCE_MODEL ?? 'haiku',
      maxUsdPerDay: Number(process.env.RINGFENCE_MAX_USD_PER_DAY ?? 5), timeoutMs: 10 * 60_000, prDryRun: !!FROM,
      checkCmd: process.env.RINGFENCE_CHECK, prBase: process.env.RINGFENCE_PR_BASE,
    })
  : null
const runs: Record<string, AgentRun> = {} // task window id -> what the real run reported
const taskWindowOf: Record<string, string> = {} // engine run id -> task window id

const windows: Window[] = []
const judgments: Record<string, Judgment> = {}
const approvals: Record<string, string> = {}
const beeTodoOf: Record<string, string> = {} // engine todoId -> Bee todo id
let emitted = 0
let windowSeq = 0
let buffer: Utterance[] = []
let lastChunk = Date.now()
let busy = Promise.resolve()

console.log(`ringfence live. judge=${STANDIN ? 'standin:claude-haiku (NOT Jev)' : 'jev'} effects=${EFFECTS ? 'ON: writes Bee todos' : 'off (dry run)'} agents=${EXECUTE ? `RUN on ${resolve(REPO!)}, worktrees in ~/.ringfence/worktrees` : 'printed only'}`)
console.log(`log: ${logFile}\nnotes: ${notesFile}`)

function closeWindow(chunkText?: string) {
  if (!buffer.length) return
  const utterances = buffer
  buffer = []
  const w: Window = {
    id: `L${String(++windowSeq).padStart(3, '0')}`,
    startedAt: utterances[0].spokenAt,
    endedAt: new Date().toISOString(),
    chunkText,
    utterances,
  }
  busy = busy.then(() => judgeAndAct(w)).catch((e) => console.error('window failed:', e.message))
}

async function judgeAndAct(w: Window) {
  const openQuestions = openQuestionsAt(windows, judgments, runs, DEFAULT_POLICY, w.endedAt, { executeRuns: MODE })
  const request = buildRequest(w, { previousSummary: windows.at(-1)?.chunkText, openQuestions, now: w.endedAt })
  const t0 = Date.now()
  const response = STANDIN ? await standin(request) : await jev(request)
  windows.push(w)
  judgments[w.id] = { windowId: w.id, judge: STANDIN ? 'standin:claude-haiku' : response.model, latencyMs: Date.now() - t0, request, response }
  log({ kind: 'window', window: w, judgment: judgments[w.id] })
  const a = response.answers as Record<string, { choice?: string; noul?: number; score?: number }>
  console.log(`\n[${w.id}] ${w.utterances.length} utt, judged in ${Date.now() - t0} ms: intent=${a.intent.choice} media=${a.media.noul?.toFixed(2)} climate=${a.climate.score?.toFixed(2)}`)
  await emitNew()
}

// Replay everything so far and act on events not yet emitted. Runs after each judged window, run report and tick.
async function emitNew() {
  try { return await emitEvents() } finally { writeSnapshot() }
}

async function emitEvents() {
  const r = replay(windows, judgments, runs, DEFAULT_POLICY, approvals, new Date().toISOString(), { executeRuns: MODE })
  const fresh = r.events.slice(emitted)
  emitted = r.events.length
  for (const e of fresh) {
    console.log(`  ring ${e.ring ?? '-'} ${e.kind}${e.held ? ' [held]' : ''}: ${e.text}`)
    const writes = EFFECTS && e.bee?.startsWith('bee todos') && !e.held && e.todoId
    if (e.bee && !runner) console.log(`    ${writes ? 'RUN' : 'would run'}: ${e.bee}`)
    if (writes) {
      const text = /--text "([^"]*)"/.exec(e.bee!)?.[1] ?? e.text
      const todo = await createTodo(`[ringfence] ${text}`, e.kind === 'exhale.nudge' ? new Date(Date.now() + 5000).toISOString() : undefined)
      beeTodoOf[e.todoId!] = String(todo.id)
      log({ kind: 'bee.todo', engineTodoId: e.todoId, bee: todo })
    }
    if (AUTO_TICK && e.kind === 'pr.proposed' && e.todoId) {
      approvals[e.todoId] = new Date().toISOString()
      console.log(`    auto-tick (testing): approved ${e.todoId}`)
      busy = busy.then(emitNew)
    }
    if (TEST_ANSWER && e.kind === 'agent.question') spokenReplies.push(TEST_ANSWER)
    // Ring 0: a note to self. Private, so it lives next to the capture, never in a repo.
    if (e.kind === 'note.saved' && !e.held) appendFileSync(notesFile, `- ${new Date(e.at).toISOString().slice(0, 16)}Z ${e.text.replace(/^Noted, not acted on: /, '')}\n`)
    if (runner) act(e)
    log({ kind: 'event', event: e })
  }
}

// Ring 1 and ring 2 effects. Each finished step feeds back into the replay.
function act(e: EngineEvent) {
  if (!runner) return
  if (e.kind === 'agent.started' && e.windowId && e.runId && e.task) {
    const taskWindow = e.windowId
    taskWindowOf[e.runId] = taskWindow
    const w = windows.find((x) => x.id === taskWindow)!
    const context = windows
      .filter((x) => x.id !== taskWindow && Date.parse(x.endedAt) <= Date.parse(w.endedAt) && Date.parse(w.endedAt) - Date.parse(x.endedAt) <= 10 * 60_000)
      .map((x) => x.chunkText).filter((t): t is string => !!t)
    console.log(`    agent: planning "${e.task}" (read-only tools)`)
    // Speech recognition writes "new-utterance-chunks" as "new utterance chunks": compare letters and digits only.
    const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
    const facts = Object.entries(shapes)
      .filter(([type]) => squash(e.task!).includes(squash(type)))
      .map(([type, shape]) => `Bee stream event "${type}" has this payload shape: ${JSON.stringify(shape)}`)
    if (facts.length) console.log(`    agent: grounded with ${facts.length} observed event shape(s)`)
    runner.start(taskWindow, e.task, context, facts)
      .then((run) => {
        runs[taskWindow] = run
        console.log(`    agent: ${run.question ? `asks "${run.question}"` : run.diffStat} (${(run.durationMs / 1000).toFixed(0)} s, US$${run.costUsd.toFixed(2)})`)
        log({ kind: 'agent.run', run })
        busy = busy.then(emitNew)
      })
      .catch((err: Error) => { console.error(`    agent failed: ${err.message}`); log({ kind: 'agent.error', window: taskWindow, error: err.message }) })
  }
  if (e.kind === 'agent.resumed' && e.runId && e.windowId) {
    const taskWindow = taskWindowOf[e.runId]
    const answer = windows.find((x) => x.id === e.windowId)!.utterances.map((u) => u.text).join(' ')
    console.log(`    agent: resuming with "${answer}" (file tools, no shell)`)
    runner.resume(taskWindow, answer)
      .then((res) => {
        runs[taskWindow] = { ...runs[taskWindow], resume: res }
        console.log(`    agent: ${res.diffStat} (${(res.durationMs / 1000).toFixed(0)} s, US$${res.costUsd.toFixed(2)})`)
        log({ kind: 'agent.resume', window: taskWindow, res })
        busy = busy.then(emitNew)
      })
      .catch((err: Error) => { console.error(`    agent resume failed: ${err.message}`); log({ kind: 'agent.error', window: taskWindow, error: err.message }) })
  }
  if (e.kind === 'pr.approved' && e.runId) {
    try {
      const out = runner.openPr(taskWindowOf[e.runId])
      console.log(`    ring 2: ${out}`)
      log({ kind: 'pr', window: taskWindowOf[e.runId], out })
    } catch (err) { console.error(`    PR failed: ${(err as Error).message}`) }
  }
}

// The shape of each Bee event type seen so far, with values redacted: keys, enums and nesting, no speech.
// An agent asked to handle an undocumented event gets the real shape instead of guessing one (seen 25 Sep 2026).
const shapes: Record<string, unknown> = {}
function redactShape(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [redactShape(v[0])] : []
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactShape(x)]))
  if (typeof v === 'string') return /^[A-Z_]{2,32}$/.test(v) || /^[a-z]+(-[a-z]+)+$/.test(v) ? v : '<string>' // enums and event names only
  if (typeof v === 'number') return 0
  return v
}

function onEvent(ev: Record<string, any>) {
  if (typeof ev.type === 'string' && !(ev.type in shapes)) shapes[ev.type] = redactShape(ev)
  switch (ev.type) {
    case 'new-utterance': {
      const u = ev.utterance ?? {}
      // A replayed file is spoken "now": its own timestamps belong to the day it was scripted for.
      const spokenAt = FROM || !u.spoken_at ? new Date().toISOString() : String(u.spoken_at)
      buffer.push({ id: Number(u.id ?? 0), text: String(u.text ?? ''), spokenAt })
      break
    }
    case 'new-utterance-chunks': // undocumented; carries Bee's own segment summary (FRICTION-LOG F35)
      lastChunk = Date.now()
      // Open question from F35: is any tag other than CONVERSATION ever sent (for example for media)?
      console.log(`\n  chunk tags: ${JSON.stringify(ev.chunks?.map((c: { tags: string[] }) => c.tags))}`)
      log({ kind: 'bee.chunk', ev })
      closeWindow(ev.chunks?.map((c: { chunk_text: string }) => c.chunk_text).join(' '))
      break
    case 'delete-conversation':
      console.log(`\n  Bee deleted conversation ${ev.conversation_id ?? ev.id}. Its utterances stay in this log (FRICTION-LOG F29).`)
      log({ kind: 'bee.delete', ev })
      break
  }
}

// The dashboard's view of this process: everything it needs to replay the day so far.
let snapshot = '{}'
function writeSnapshot() {
  snapshot = JSON.stringify({ live: true, updatedAt: new Date().toISOString(), judgeName: STANDIN ? 'standin:claude-haiku' : 'jev', windows, judgments, runs, approvals })
  writeFileSync(join(logDir, 'state.json'), snapshot)
}

createServer((req, res) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  const origin = req.headers.origin
  // Refuse other hostnames (DNS rebinding) and other origins: any page in the browser could otherwise read your speech.
  if (!['localhost', '127.0.0.1'].includes(host) || (origin && !UI_ORIGINS.has(origin))) { res.writeHead(403).end(); return }
  if (req.url !== '/state') { res.writeHead(404).end(); return }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) })
  res.end(snapshot)
}).listen(UI_PORT, '127.0.0.1', () => console.log(`dashboard: http://localhost:5188/?live (state on 127.0.0.1:${UI_PORT})`))
writeSnapshot()

// Approval = a todo we created now reads completed: true in the changefeed. Only polls while something waits.
let cursor: string | undefined
async function pollApprovals() {
  if (!Object.keys(beeTodoOf).length) return
  let feed: Awaited<ReturnType<typeof changedSince>>
  try { feed = await changedSince(cursor) } catch (e) { console.error('bee changed failed:', (e as Error).message); return }
  cursor = feed.cursor
  let ticked = false
  for (const t of feed.todos) {
    const engineId = Object.entries(beeTodoOf).find(([, b]) => b === String(t.id))?.[0]
    if (engineId && t.completed === true && !approvals[engineId]) {
      approvals[engineId] = new Date().toISOString()
      ticked = true
      console.log(`\n  tick seen in changefeed for ${engineId} (Bee todo ${t.id})`)
      log({ kind: 'approval', engineId, bee: t })
    }
  }
  if (ticked) busy = busy.then(emitNew)
}

// Tail the newest capture file. On first sight start at its end, so old capture is not re-judged; a newer file is read whole.
function tailCapture() {
  let file: string | null = null, offset = 0, rest = '', warned = false
  setInterval(() => {
    if (!existsSync(CAPTURE_DIR)) return
    const newest = readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => join(CAPTURE_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (!newest) { if (!warned) console.log(`waiting for a capture file in ${CAPTURE_DIR}`); warned = true; return }
    if (newest !== file) { offset = file === null ? statSync(newest).size : 0; file = newest; rest = ''; console.log(`tailing ${file}`) }
    const size = statSync(file).size
    if (size < offset) offset = 0
    if (size === offset) return
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(size - offset)
    readSync(fd, buf, 0, buf.length, offset)
    closeSync(fd)
    offset = size
    const lines = (rest + buf.toString('utf8')).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('{')) continue
      try { const o = JSON.parse(line); onEvent(o.type ? o : o.event ?? o) } catch { /* not an event line */ }
    }
  }, 1000)
}

// In a file replay the clock does not wait for agents, so each window waits for the running agent to finish.
async function settle() {
  for (;;) {
    await busy
    await new Promise((r) => setTimeout(r, 300))
    if (!runner?.busy()) { await busy; return }
  }
}

async function fromFile(file: string) {
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.startsWith('{')) continue
    const ev = JSON.parse(line)
    onEvent(ev)
    if (ev.type === 'new-utterance-chunks') await settle()
    // Testing: the person answers the agent's question out loud, as its own Bee segment.
    while (spokenReplies.length) {
      onEvent({ type: 'new-utterance', utterance: { text: spokenReplies.shift(), spoken_at: new Date().toISOString() } })
      onEvent({ type: 'new-utterance-chunks', chunks: [{ chunk_text: 'Speaker answers a question from their coding agent.', tags: ['CONVERSATION'] }] })
      await settle()
    }
  }
  closeWindow()
  await settle()
  console.log(`\nend of ${file}: ${windows.length} windows judged`)
  if (STAY) console.log('still serving the dashboard (--stay). Ctrl+C to quit.')
  else process.exit(0)
}

if (FROM) fromFile(FROM)
else {
  console.log(`capture: ${CAPTURE_DIR}`)
  setInterval(() => { if (buffer.length >= 3 && Date.now() - lastChunk > FLUSH_MS) closeWindow() }, 15_000)
  setInterval(() => { busy = busy.then(pollApprovals) }, 10_000)
  tailCapture()
}
