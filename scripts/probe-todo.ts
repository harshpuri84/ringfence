// Probe, run by a person with the watch on:
//   1. Does a Bee todo with --alarm-at buzz the phone or the watch, and how late?
//   2. When you tick it in the Bee app, how long until the `bee changed` changefeed shows completed: true?
//   node scripts/probe-todo.ts
// Also listens to the stream for todo events. On 25 Sep 2026 the stream sent none, for app ticks or CLI changes.
// It creates ONE todo and deletes nothing.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createTodo, changedSince } from '../src/bee.ts'

const alarmMs = Date.now() + 60_000
const alarmAt = new Date(alarmMs).toISOString()
let cursor = (await changedSince()).cursor
const id = String((await createTodo(`[ringfence probe] Tick me after it buzzes (${alarmAt.slice(11, 19)}Z)`, alarmAt)).id)
const t0 = Date.now()
const since = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`
console.log(`created todo ${id}, alarm at ${alarmAt}`)
console.log('1. Watch your wrist and phone. Note which buzzes, and how long after the alarm time.')
console.log('2. Then tick the todo in the Bee app. The changefeed is polled every 5 s.\n')

// Own process group: Bee's npm wrapper blocks in spawnSync, so killing only the wrapper orphans the real binary.
const p = spawn('bee', ['stream', '--types', 'all', '--json'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const stopStream = () => { try { process.kill(-p.pid!, 'SIGTERM') } catch { /* already gone */ } }
process.on('SIGINT', () => { stopStream(); process.exit(130) })
createInterface({ input: p.stdout }).on('line', (line) => {
  if (!line.startsWith('{')) return
  const ev = JSON.parse(line)
  if (String(ev.type).startsWith('todo')) console.log(`${since()} stream ${ev.type}: ${JSON.stringify(ev).slice(0, 300)}`)
})

const poll = setInterval(async () => {
  const feed = await changedSince(cursor)
  cursor = feed.cursor
  const t = feed.todos.find((x) => String(x.id) === id)
  if (t?.completed) {
    console.log(`${since()} changefeed: todo ${id} completed. ${((Date.now() - alarmMs) / 1000).toFixed(0)} s after the alarm time.`)
    finish()
  }
}, 5_000)

function finish() {
  clearInterval(poll)
  stopStream()
  console.log(`\ndone. Remove the probe todo when you like: bee todos delete ${id}`)
  process.exit(0)
}
setTimeout(() => { console.log(`${since()} no tick seen in 5 minutes.`); finish() }, 300_000)
