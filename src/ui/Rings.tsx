import { useState } from 'react'
import type { EngineEvent } from '../engine/types.ts'
import { hhmm, ms } from './time.ts'

// Three rings around you. Each action sits on its ring at its time of day, read clockwise from the top.
const S = 400, C = S / 2
const BANDS = [
  { ring: 0, r0: 26, r1: 72, fill: '#fbf1eb', ink: 'var(--ring0)', name: 'Ring 0 · acts on you' },
  { ring: 1, r0: 72, r1: 122, fill: '#f8e4da', ink: 'var(--ring1)', name: 'Ring 1 · sandbox' },
  { ring: 2, r0: 122, r1: 172, fill: '#f1d6c9', ink: 'var(--ring2)', name: 'Ring 2 · leaves the machine' },
]
const SHOW = new Set(['note.saved', 'exhale.nudge', 'agent.started', 'agent.question', 'agent.result', 'agent.binned', 'agent.shadow', 'agent.capped', 'pr.proposed', 'pr.approved'])

export function Rings(props: { events: EngineEvent[]; start: number; end: number; now: number; pendingIds: Set<string> }) {
  const { events, start, end, now, pendingIds } = props
  const [hover, setHover] = useState<{ e: EngineEvent; x: number; y: number } | null>(null)
  // The day runs clockwise over 330 degrees; the 30-degree gap at the top separates evening from morning.
  const GAP = Math.PI / 6
  const angle = (t: number) => -Math.PI / 2 + GAP / 2 + ((t - start) / (end - start)) * (2 * Math.PI - GAP)
  const hours: number[] = []
  for (let t = Math.ceil(start / 36e5) * 36e5; t <= end; t += 2 * 36e5) hours.push(t)
  const pos = (t: number, r: number) => [C + r * Math.cos(angle(t)), C + r * Math.sin(angle(t))]

  // Delivered-after-hold copies duplicate an action; draw the action once, at its first time.
  const seen = new Set<string>()
  const dots = events.filter((e) => {
    if (!SHOW.has(e.kind) || e.ring === undefined) return false
    const key = `${e.kind}:${e.runId ?? e.at}:${e.todoId ?? ''}`
    if (e.text.startsWith('Delivered after hold')) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const [hx, hy] = pos(now, 172)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 440, display: 'block', margin: '0 auto' }} role="img" aria-label="Actions placed on three rings by time of day">
        {BANDS.slice().reverse().map((b) => <circle key={b.ring} cx={C} cy={C} r={b.r1} fill={b.fill} stroke="var(--surface)" strokeWidth={2} />)}
        <circle cx={C} cy={C} r={26} fill="var(--surface)" stroke="var(--border)" />
        <text x={C} y={C + 4} textAnchor="middle" fontSize={11} fill="var(--text-2)">you</text>
        {BANDS.map((b) => (
          <text key={b.ring} x={C} y={C - (b.r0 + b.r1) / 2 + 4} textAnchor="middle" fontSize={11} fill="var(--text-2)" fontWeight={600}>{b.ring}</text>
        ))}
        {hours.map((t) => { const [tx, ty] = pos(t, 172); const [lx, ly] = pos(t, 178); return (
          <g key={t}><line x1={tx} y1={ty} x2={lx} y2={ly} stroke="var(--border-strong)" strokeWidth={1} />
            <text x={pos(t, 189)[0]} y={pos(t, 189)[1] + 3} textAnchor="middle" fontSize={9} fill="var(--text-2)" fontFamily="var(--mono)">{hhmm(t)}</text></g>) })}
        <line x1={C} y1={C} x2={hx} y2={hy} stroke="var(--text)" strokeWidth={1} opacity={0.35} />
        {dots.map((e, i) => {
          const b = BANDS[e.ring!]
          const r = (b.r0 + b.r1) / 2 + ((i % 3) - 1) * 9
          const [cx, cy] = pos(ms(e.at), r)
          const waiting = e.todoId && pendingIds.has(e.todoId)
          const common = {
            onPointerEnter: (ev: React.PointerEvent) => setHover({ e, x: ev.nativeEvent.offsetX, y: ev.nativeEvent.offsetY }),
            onPointerLeave: () => setHover(null),
            style: { cursor: 'default' },
          }
          if (e.kind === 'agent.binned' || e.kind === 'agent.shadow' || e.kind === 'agent.capped')
            return <g key={i} {...common}><circle cx={cx} cy={cy} r={10} fill="transparent" /><path d={`M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}`} stroke="var(--muted)" strokeWidth={2} /></g>
          if (e.held)
            return <g key={i} {...common}><circle cx={cx} cy={cy} r={10} fill="transparent" /><circle cx={cx} cy={cy} r={6} fill="var(--hold)" stroke="var(--hold-ink)" strokeDasharray="2 2" strokeWidth={1.5} /></g>
          return (
            <g key={i} {...common}>
              <circle cx={cx} cy={cy} r={10} fill="transparent" />
              <circle cx={cx} cy={cy} r={waiting ? 7 : 6} fill={waiting ? 'var(--surface)' : b.ink} stroke={waiting ? 'var(--accent)' : 'var(--surface)'} strokeWidth={waiting ? 2.5 : 2}>
                {waiting && <animate attributeName="r" values="6;8;6" dur="1.6s" repeatCount="indefinite" />}
              </circle>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="tip" style={{ left: Math.min(hover.x + 10, 240), top: hover.y + 10 }}>
          <div className="mono" style={{ color: 'var(--muted)' }}>{hhmm(hover.e.at)} · ring {hover.e.ring} · {hover.e.kind}</div>
          <div>{hover.e.held ? '[held] ' : ''}{hover.e.text}</div>
        </div>
      )}
    </div>
  )
}

export const RING_LEGEND = BANDS
