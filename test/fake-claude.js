#!/usr/bin/env node
// Stands in for `claude -p` in the runner tests. Behaviour is set by environment variables:
//   FAKE_PLAN  = ask | ready | deny | stray-deny     (the read-only planning pass)
//   FAKE_EDIT  = good | broken | none                (the first edit pass)
//   FAKE_REPAIR = fix | keep                         (a repair pass after failed checks)
//   FAKE_LOG   = file that receives one JSON line per call with the arguments
import { appendFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const tools = flag('--tools') ?? ''
const prompt = args[args.length - 1]
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n')

const out = (result, extra = {}) => {
  process.stdout.write(JSON.stringify({ session_id: 'fake-session-1', total_cost_usd: 0.01, num_turns: 6, result, modelUsage: { 'fake-model': {} }, permission_denials: [], ...extra }))
}
const good = 'async function connect(url) {\n  for (let i = 0; i < 5; i++) {\n    try { return await fetch(url) } catch {}\n  }\n}\nmodule.exports = { connect }\n'

if (!tools.includes('Edit')) {
  const mode = process.env.FAKE_PLAN ?? 'ready'
  if (mode === 'ask') out('Plan: add a retry loop.\nQUESTION: How many retries?')
  else if (mode === 'deny') out('I need permission to read the repository.', { num_turns: 3, permission_denials: [{ tool_name: 'Read' }, { tool_name: 'Glob' }] })
  else if (mode === 'stray-deny') out('Plan: add a retry loop.\nREADY', { num_turns: 19, permission_denials: [{ tool_name: 'Read' }] })
  else out('Plan: add a retry loop.\nREADY')
} else if (/checks failed/.test(prompt)) {
  if ((process.env.FAKE_REPAIR ?? 'fix') === 'fix') writeFileSync('stream.js', good)
  out('Fixed the syntax error.')
} else {
  const mode = process.env.FAKE_EDIT ?? 'good'
  if (mode === 'good') writeFileSync('stream.js', good)
  if (mode === 'broken') writeFileSync('stream.js', 'async function connect(url) {\n  for (let i = 0; i < 5; i++ {\n')
  out(mode === 'none' ? 'Nothing to change.' : 'Implemented the retry loop.')
}
