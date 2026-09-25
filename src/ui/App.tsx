import { useEffect, useMemo, useState } from 'react'
import type { ChoiceA, EngineEvent, Judgment, NoulA, ScoreA, Window } from '../engine/types.ts'
import { replay, top } from '../engine/engine.ts'
import { DEFAULT_POLICY, type Policy } from '../engine/policy.ts'
import { ClimateChart } from './ClimateChart.tsx'
import { Rings, RING_LEGEND } from './Rings.tsx'
import { hhmm, ms } from './time.ts'
import { GAP, GAPS, gapsFor } from './gaps.ts'
import { FIXTURE, LIVE_URL, useLiveData, type DayData } from './data.ts'

const WRIST_KINDS = new Set(['agent.question', 'agent.result', 'pr.proposed', 'pr.approved', 'exhale.nudge'])
const ringInk = (r?: number) => (r === undefined ? 'var(--border-strong)' : RING_LEGEND[r].ink)

// `?live` follows live mode's snapshot on localhost; anything else replays the scripted day.
export function App() {
  const liveMode = /[?&]live\b/.test(location.search)
  const { data, error } = useLiveData(liveMode)
  if (liveMode && !data) {
    return (
      <div className="app">
        <header className="top"><h1>Ringfence</h1><span className="tag">Waiting for live mode.</span></header>
        <div className="card">
          <p>No answer from <span className="mono">{LIVE_URL}</span>{error ? ` (${error})` : ''}.</p>
          <p className="sub">Start it with <span className="mono">node scripts/live.ts --standin</span>, add <span className="mono">--execute --repo &lt;path&gt;</span> to run agents. The page retries every 2 seconds.</p>
        </div>
      </div>
    )
  }
  return <Dashboard data={liveMode ? data! : FIXTURE} />
}

function Dashboard({ data }: { data: DayData }) {
  const { windows, judgments, runs, live } = data
  const judgeName = data.judgeName
  const isStandin = judgeName.startsWith('standin')
  const [, setTick] = useState(0)
  useEffect(() => { if (!live) return; const id = setInterval(() => setTick((t) => t + 1), 5000); return () => clearInterval(id) }, [live])
  const DAY_START = windows.length ? ms(windows[0].startedAt) - 10 * 60e3 : Date.now() - 60 * 60e3
  const DAY_END = live || !windows.length ? Date.now() + 5 * 60e3 : ms(windows[windows.length - 1].endedAt) + 20 * 60e3
  const [clockState, setClock] = useState(DAY_END) // open on the finished day; Replay day plays it from the start
  const clock = live ? Date.now() : clockState
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10) // minutes of the day per real second
  const [exhale, setExhale] = useState(() => location.search.includes('exhale'))
  const [requireAddress, setRequireAddress] = useState(false)
  const [agentTrust, setAgentTrust] = useState<'shadow' | 'auto'>('auto')
  const [taskT, setTaskT] = useState(DEFAULT_POLICY.thresholds.task)
  const [approvals, setApprovals] = useState<Record<string, string>>({})
  const [focusGap, setFocusGap] = useState<string | null>(null)
  const showGap = (id: string) => { setFocusGap(id); document.getElementById(`gap-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  // Deep link to one request, e.g. /?end#gap-todo-events
  useEffect(() => { const m = /^#gap-(.+)$/.exec(location.hash); if (m && GAP[m[1]]) { setFocusGap(m[1]); document.getElementById(`gap-${m[1]}`)?.scrollIntoView({ block: 'center' }) } }, [])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setClock((c) => {
        const n = c + speed * 60e3 * 0.1
        if (n >= DAY_END) { setPlaying(false); return DAY_END }
        return n
      })
    }, 100)
    return () => clearInterval(id)
  }, [playing, speed, DAY_END])

  const policy: Policy = useMemo(() => ({
    ...DEFAULT_POLICY,
    requireAddress,
    thresholds: { ...DEFAULT_POLICY.thresholds, task: taskT },
    exhale: { ...DEFAULT_POLICY.exhale, enabled: exhale },
    trust: { ...DEFAULT_POLICY.trust, agent: agentTrust },
  }), [exhale, requireAddress, agentTrust, taskT])

  // Judgments are stored. Changing policy re-runs code only, never the model.
  useEffect(() => setApprovals({}), [policy])
  const nowIso = new Date(clock).toISOString()
  const r = useMemo(
    () => replay(windows, judgments, runs, policy, live ? data.approvals : approvals, nowIso, live ? { executeRuns: 'live' } : {}),
    [windows, judgments, runs, live, data.approvals, policy, approvals, nowIso],
  )

  const visible = windows.filter((w) => ms(w.startedAt) <= clock)
  const current = visible[visible.length - 1]
  const pendingIds = new Set(r.pendingTodos.map((e) => e.todoId!))
  const approvedIds = new Set(r.events.filter((e) => e.kind === 'pr.approved').map((e) => e.todoId!))
  const delivered = r.events.filter((e) => e.bee && WRIST_KINDS.has(e.kind) && !e.held)
  const deliveredKeys = new Set(delivered.map((e) => e.todoId))
  const stillHeld = r.events.filter((e) => e.held && !deliveredKeys.has(e.todoId))
  const started = r.events.filter((e) => e.kind === 'agent.started').length
  const binned = r.events.filter((e) => e.kind === 'agent.binned').length

  const tick = (todoId: string) => setApprovals((a) => ({ ...a, [todoId]: nowIso }))

  return (
    <div className="app">
      <header className="top">
        <h1>Ringfence</h1>
        <span className="tag">An agent that acts on what Bee hears, inside rings you draw.</span>
      </header>
      {live ? (
        <div className="badges">
          <span className="badge live">Live from your watch · updated {data.updatedAt ? hhmm(data.updatedAt) : '-'}</span>
          <span className={`badge ${isStandin ? 'warn' : ''}`}>Judge: {isStandin ? 'stand-in, Claude Haiku. Not Jev' : judgeName}</span>
          <span className="badge">Agent runs: {Object.keys(runs).length} real</span>
          <span className="badge">Ticks: in the Bee app</span>
        </div>
      ) : (
        <div className="badges">
          <span className="badge warn">Scripted day. Synthetic content, not real capture.</span>
          <span className={`badge ${isStandin ? 'warn' : ''}`}>Judge: {isStandin ? 'stand-in, Claude Haiku. Not Jev (no working key on 24 Sep)' : judgeName}</span>
          <span className="badge">Agent runs: recorded 24 Sep with Claude Code headless</span>
          <span className="badge">Bee writes: shown as commands, not executed</span>
        </div>
      )}

      {!live && <>
      <div className="controls">
        <button className="btn primary" onClick={() => { if (clock >= DAY_END) setClock(DAY_START); setPlaying((p) => !p) }}>{playing ? 'Pause' : clock >= DAY_END ? 'Replay day' : 'Play day'}</button>
        <span className="clock">{hhmm(clock)}</span>
        <div className="scrub">
          <input type="range" min={DAY_START} max={DAY_END} step={30e3} value={clock} aria-label="Time of day"
            onChange={(e) => { setPlaying(false); setClock(Number(e.target.value)) }} />
        </div>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={3}>3 min/s</option><option value={10}>10 min/s</option><option value={30}>30 min/s</option>
          </select>
        </label>
        <button className="btn small" onClick={() => { setPlaying(false); setClock(DAY_END) }}>End of day</button>
      </div>

      <div className="controls">
        <label><input type="checkbox" checked={exhale} onChange={(e) => setExhale(e.target.checked)} /> Exhale lens: breath nudges</label>
        <label>Agent trust
          <select value={agentTrust} onChange={(e) => setAgentTrust(e.target.value as 'shadow' | 'auto')}>
            <option value="auto">auto (demo, pre-promoted)</option><option value="shadow">shadow (day one)</option>
          </select>
        </label>
        <label><input type="checkbox" checked={requireAddress} onChange={(e) => setRequireAddress(e.target.checked)} /> Only act when addressed ("Ringfence, ...")</label>
        <label>Task threshold <input type="range" min={0.5} max={0.99} step={0.01} value={taskT} onChange={(e) => setTaskT(Number(e.target.value))} /> <span className="mono">{taskT.toFixed(2)}</span></label>
        <span className="hint">Changing these re-runs code over stored judgments. No model call.</span>
      </div>
      </>}

      <div className="grid">
        <section className="col-day card">
          <div className="head"><h2>What Bee heard</h2><Needs ids={['chunks-rest']} onPick={showGap} /></div>
          <p className="sub">One window per Bee segment (the undocumented <span className="mono">new-utterance-chunks</span> event). Chips show the judge's answer; red means it disagrees with the script's label.</p>
          <div className="day">
            {visible.slice().reverse().map((w) => <WindowCard key={w.id} w={w} j={judgments[w.id]} now={w === current} onPick={showGap} />)}
            {!visible.length && <p className="empty">{live ? 'Waiting for Bee. Speak near the watch.' : `Press Play day. The first window is at ${hhmm(windows[0].startedAt)}.`}</p>}
          </div>
        </section>

        <section>
          <div className="card">
            <h2>Climate of the room</h2>
            <p className="sub">Smoothed score of the words, 0 to 4. Not your feelings: Bee cannot tell who spoke. Shaded = holding anything that would reach your wrist. Dashed circles = media, not counted.</p>
            <ClimateChart points={r.climate} windows={windows} events={r.events} start={DAY_START} end={DAY_END} now={clock}
              holdAt={policy.manners.holdAt} releaseBelow={policy.manners.releaseBelow} showNudges={exhale} />
          </div>
          <div className="card rings-wrap">
            <h2>The rings</h2>
            <p className="sub">Every action sits on the ring its blast radius puts it in, at its time of day, clockwise from the top. Pulsing = waiting for your tick. Cross = binned or shadow. Dashed = held.</p>
            <Rings events={r.events} start={DAY_START} end={DAY_END} now={clock} pendingIds={pendingIds} />
            <div className="ring-legend">
              <div><span className="sw" style={{ background: 'var(--ring0)' }} /><b>0 · acts on you</b><br />notes, breath nudges. Auto.</div>
              <div><span className="sw" style={{ background: 'var(--ring1)' }} /><b>1 · sandbox</b><br />coding agent on a branch. Auto after trust is earned.</div>
              <div><span className="sw" style={{ background: 'var(--ring2)' }} /><b>2 · leaves the machine</b><br />open a PR, send, pay. Never without a tick.</div>
            </div>
          </div>
        </section>

        <section>
          <div className="card wrist">
            <div className="head"><h2>On your wrist</h2><Needs ids={['watch-alerts']} onPick={showGap} /></div>
            <p className="sub">What would arrive as Bee todos. Tick a PR request to approve it. The engine reads the tick from Bee's changefeed, because the stream never sends todo events.</p>
            {delivered.slice().reverse().map((e, i) => {
              const waiting = e.kind === 'pr.proposed' && pendingIds.has(e.todoId!)
              const done = e.kind === 'pr.proposed' && approvedIds.has(e.todoId!)
              return (
                <div key={i} className={`todo ${waiting ? 'waiting' : ''} ${done ? 'done' : ''}`}>
                  <span className="ringdot" style={{ background: ringInk(e.ring) }} />
                  <div className="body">
                    <div className="when">{hhmm(e.at)} · ring {e.ring}</div>
                    <div>{e.text.replace(/^Delivered after hold: /, '')}</div>
                    {waiting && !live && <button className="btn small primary" style={{ marginTop: 6 }} onClick={() => tick(e.todoId!)}>Tick to approve</button>}
                    {waiting && live && <div className="hint">Tick it in the Bee app.</div>}
                    {done && <div className="hint">Approved. PR opened.</div>}
                    <Needs ids={gapsFor(e).filter((g) => g !== 'watch-alerts')} onPick={showGap} />
                  </div>
                </div>
              )
            })}
            {!delivered.length && <p className="empty">Nothing yet.</p>}
            {stillHeld.length > 0 && <>
              <h2 style={{ marginTop: 12 }}>Held, room is tense</h2>
              {stillHeld.map((e, i) => (
                <div key={i} className="todo held"><span className="ringdot" style={{ background: ringInk(e.ring) }} />
                  <div className="body"><div className="when">{hhmm(e.at)} · ring {e.ring}</div><div>{e.text}</div></div></div>
              ))}
            </>}
          </div>

          <div className="card">
            <h2>Day so far</h2>
            <div className="stats">
              <div className="stat"><div className="v">{started}</div><div className="k">agent runs</div></div>
              <div className="stat"><div className="v">{binned}</div><div className="k">binned, never sent</div></div>
              <div className="stat"><div className="v">${r.costUsd.toFixed(2)}</div><div className="k">agent cost</div></div>
              <div className="stat"><div className="v">{delivered.length}</div><div className="k">reached wrist</div></div>
            </div>
          </div>

          <div className="card">
            <h2>Engine log</h2>
            <div className="log">
              {r.events.slice().reverse().map((e, i) => <LogRow key={i} e={e} onPick={showGap} />)}
              {!r.events.length && <p className="empty">Nothing yet.</p>}
            </div>
          </div>
        </section>
      </div>

      <ShapePanel events={r.events} windowsSeen={visible.length} focus={focusGap} />

      {!live && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Judge against the script's labels</h2>
          <p className="sub">17 windows labelled by the script author, not yet reviewed by a person. Too small to certify anything; big enough to see failure modes.</p>
          <EvalTable windows={windows} judgments={judgments} judgeName={judgeName} />
        </div>
      )}

      <footer className="note">
        Prototype written overnight 24 to 25 September 2026. Thresholds were set by hand on this one scripted day and mean nothing yet.
        Tested on a real watch on 25 September: a tick reaches Bee's server and shows up in the changefeed, but never as a stream event. An alarm todo buzzed the phone, not the watch, about 30 s late.
      </footer>
    </div>
  )
}

function WindowCard({ w, j, now, onPick }: { w: Window; j?: Judgment; now: boolean; onPick: (id: string) => void }) {
  const a = j?.response.answers
  const [intent, p] = a ? top(a.intent as ChoiceA) : ['?', 0]
  const media = a ? (a.media as NoulA).noul : 0
  const climate = a ? (a.climate as ScoreA).score : 0
  const perf = a ? (a.performance as NoulA).noul : 0
  const l = w.label
  return (
    <div className={`win ${now ? 'now' : ''} ${media >= 0.6 ? 'media' : ''}`}>
      <div className="meta"><span>{hhmm(w.startedAt)} · {w.place}</span><span className="mono">{w.id}</span></div>
      {w.utterances.map((u) => <p key={u.id} className="utt">{u.text}</p>)}
      {a && (
        <div className="chips">
          <span className={`chip ${intent === 'task' || intent === 'answer' ? 'hot' : ''} ${l && l.intent !== intent ? 'miss' : ''}`}>intent {intent} {p.toFixed(2)}</span>
          <span className={`chip ${l && l.media !== media >= 0.5 ? 'miss' : ''}`}>media {media.toFixed(2)}</span>
          <span className="chip">climate {climate.toFixed(1)}</span>
          {perf >= 0.5 && <span className="chip hot">about to present {perf.toFixed(2)}</span>}
          {l && (l.intent !== intent || l.media !== media >= 0.5) && <span className="chip miss">script: {l.intent}{l.media ? ', media' : ''}</span>}
        </div>
      )}
      {media >= 0.6 && <Needs ids={['media-tags']} onPick={onPick} />}
    </div>
  )
}

function LogRow({ e, onPick }: { e: EngineEvent; onPick: (id: string) => void }) {
  return (
    <div className={`row ${e.held ? 'held' : ''}`}>
      <span className="mono">{hhmm(e.at)}</span>
      <span className="mono" style={{ color: ringInk(e.ring) }}>{e.ring ?? '·'}</span>
      <div>
        <div>{e.held ? '[held] ' : ''}{e.text}</div>
        {e.bee && <div className="cmd">{e.bee}</div>}
        {!e.held && <Needs ids={gapsFor(e)} onPick={onPick} />}
      </div>
    </div>
  )
}

function EvalTable({ windows, judgments, judgeName }: { windows: Window[]; judgments: Record<string, Judgment>; judgeName: string }) {
  const isStandin = judgeName.startsWith('standin')
  const rows = [
    { k: 'Intent (none, note, task, answer)', f: (w: Window, a: Judgment['response']['answers']) => top(a.intent as ChoiceA)[0] === w.label!.intent },
    { k: 'Media playback, yes or no', f: (w: Window, a: Judgment['response']['answers']) => ((a.media as NoulA).noul >= 0.5) === w.label!.media },
    { k: 'About to present, yes or no', f: (w: Window, a: Judgment['response']['answers']) => ((a.performance as NoulA).noul >= 0.5) === w.label!.performance },
  ]
  const labelled = windows.filter((w) => w.label && judgments[w.id])
  const mae = labelled.reduce((s, w) => s + Math.abs((judgments[w.id].response.answers.climate as ScoreA).score - w.label!.climate), 0) / labelled.length
  const latency = labelled.map((w) => judgments[w.id].latencyMs).sort((a, b) => a - b)
  return (
    <table className="eval">
      <thead><tr><th>Judgment</th><th className="num">Agrees</th><th>Misses</th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const miss = labelled.filter((w) => !r.f(w, judgments[w.id].response.answers))
          return <tr key={r.k}><td>{r.k}</td><td className="num">{labelled.length - miss.length} / {labelled.length}</td><td className="mono">{miss.map((w) => w.id).join(', ') || 'none'}</td></tr>
        })}
        <tr><td>Climate, mean absolute error</td><td className="num">{mae.toFixed(2)} levels</td><td className="mono">0 to 4 scale</td></tr>
        <tr><td>Judge latency, median</td><td className="num">{(latency[Math.floor(latency.length / 2)] / 1000).toFixed(1)} s</td><td className="mono">{isStandin ? 'stand-in via claude -p; Jev untested' : judgeName}</td></tr>
      </tbody>
    </table>
  )
}

// A marker where the vision leans on something Bee does not do yet. Click to jump to the request.
function Needs({ ids, onPick }: { ids: string[]; onPick: (id: string) => void }) {
  if (!ids.length) return null
  return (
    <div className="needs">
      {ids.map((id) => (
        <button key={id} type="button" className="need" onClick={() => onPick(id)} title={GAP[id].request}>
          needs Bee: {GAP[id].short}
        </button>
      ))}
    </div>
  )
}

function ShapePanel({ events, windowsSeen, focus }: { events: EngineEvent[]; windowsSeen: number; focus: string | null }) {
  const moments = (id: string) =>
    id === 'chunks-rest' ? windowsSeen : events.filter((e) => !e.held && gapsFor(e).includes(id)).length
  return (
    <div className="card shape" style={{ marginTop: 16 }}>
      <h2>What Amazon could ship</h2>
      <p className="sub">Each request is a measured gap between this vision and Bee today. The count is how many moments in the replay so far lean on it.</p>
      <div className="shape-scroll">
        <table>
          <thead><tr><th>Request</th><th>Bee today</th><th>What it unlocks here</th><th className="num">Moments</th></tr></thead>
          <tbody>
            {GAPS.map((g) => (
              <tr key={g.id} id={`gap-${g.id}`} className={focus === g.id ? 'focus' : ''}>
                <td><b>{g.request}</b><span className={`status ${g.status === 'measured' ? '' : 'pending'}`}>{g.status}</span><span className="ev">{g.evidence}</span></td>
                <td>{g.today}</td>
                <td>{g.unlocks}</td>
                <td className="num">{moments(g.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
