import { useRef, useState } from 'react'
import type { ClimatePoint } from '../engine/engine.ts'
import type { EngineEvent, Window } from '../engine/types.ts'
import { hhmm, ms } from './time.ts'

const W = 640, H = 230, L = 84, R = 12, T = 22, B = 26
const LEVELS = ['relaxed', 'working', 'pressured', 'tense', 'acute']

export function ClimateChart(props: {
  points: ClimatePoint[]
  windows: Window[]
  events: EngineEvent[]
  start: number
  end: number
  now: number
  holdAt: number
  releaseBelow: number
  showNudges: boolean
}) {
  const { points, windows, events, start, end, now, holdAt, releaseBelow, showNudges } = props
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const x = (t: number) => L + ((t - start) / (end - start)) * (W - L - R)
  const y = (v: number) => T + (1 - v / 4) * (H - T - B)

  const live = points.filter((p) => !p.media && p.smooth !== null)
  const path = live.map((p, i) => `${i ? 'L' : 'M'}${x(ms(p.at)).toFixed(1)},${y(p.smooth!).toFixed(1)}`).join(' ')

  // Hold bands: from the point where holding turned on to the point where it turned off (or now).
  const bands: [number, number][] = []
  let open: number | null = null
  for (const p of points) {
    if (p.media) continue
    if (p.holding && open === null) open = ms(p.at)
    if (!p.holding && open !== null) { bands.push([open, ms(p.at)]); open = null }
  }
  if (open !== null) bands.push([open, now])

  const nudges = showNudges ? events.filter((e) => e.kind === 'exhale.nudge') : []
  const hours: number[] = []
  for (let t = Math.ceil(start / 36e5) * 36e5; t <= end; t += 2 * 36e5) hours.push(t)

  const onMove = (ev: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    let best = -1, d = Infinity
    points.forEach((p, i) => { const dd = Math.abs(x(ms(p.at)) - px); if (dd < d) { d = dd; best = i } })
    if (best >= 0 && d < 40) setHover({ i: best, x: ev.clientX - r.left, y: ev.clientY - r.top })
    else setHover(null)
  }

  const hp = hover ? points[hover.i] : null
  const hw = hp ? windows.find((w) => w.id === hp.windowId) : null
  const hev = hp ? events.filter((e) => e.windowId === hp.windowId && e.kind !== 'media.skipped') : []

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Climate of the day, smoothed, 0 to 4"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'none' }}>
        {bands.map(([a, b], i) => (
          <rect key={i} x={x(a)} y={T} width={Math.max(2, x(b) - x(a))} height={H - T - B} fill="var(--hold)" />
        ))}
        {[0, 1, 2, 3, 4].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)" fontFamily="var(--mono)">{v} {LEVELS[v]}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(holdAt)} y2={y(holdAt)} stroke="var(--hold-ink)" strokeDasharray="4 4" strokeWidth={1} />
        <text x={W - R} y={y(holdAt) - 4} textAnchor="end" fontSize={10} fill="var(--hold-ink)">hold at {holdAt}</text>
        <line x1={L} x2={W - R} y1={y(releaseBelow)} y2={y(releaseBelow)} stroke="var(--border-strong)" strokeDasharray="2 4" strokeWidth={1} />
        <text x={W - R} y={y(releaseBelow) + 12} textAnchor="end" fontSize={10} fill="var(--muted)">release below {releaseBelow}</text>
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)" fontFamily="var(--mono)">{hhmm(t)}</text>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => p.media ? (
          <circle key={p.windowId} cx={x(ms(p.at))} cy={y(p.raw ?? 0)} r={4.5} fill="var(--surface)" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="2 2" />
        ) : (
          <circle key={p.windowId} cx={x(ms(p.at))} cy={y(p.smooth!)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        {nudges.map((n, i) => (
          <g key={i} transform={`translate(${x(ms(n.at))},${T - 2})`}>
            <path d="M-5,-8 L5,-8 L0,0 Z" fill="var(--ring2)" />
          </g>
        ))}
        <line x1={x(now)} x2={x(now)} y1={T} y2={H - B} stroke="var(--text)" strokeWidth={1} opacity={0.5} />
        {hp && <line x1={x(ms(hp.at))} x2={x(ms(hp.at))} y1={T} y2={H - B} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="2 3" />}
      </svg>
      {hp && hover && (
        <div className="tip" style={{ left: Math.min(hover.x + 12, 360), top: hover.y + 12 }}>
          <div className="mono" style={{ color: 'var(--muted)' }}>{hhmm(hp.at)} · {hw?.place} · {hp.windowId}</div>
          {hp.media ? (
            <div><strong>Media</strong> · raw {hp.raw?.toFixed(2)}, not counted</div>
          ) : (
            <div><strong>{hp.smooth!.toFixed(2)}</strong> smoothed · raw {hp.raw?.toFixed(2)} ({LEVELS[Math.round(hp.raw ?? 0)]}){hp.holding ? ' · holding' : ''}</div>
          )}
          {hev.slice(0, 3).map((e, i) => <div key={i} style={{ color: 'var(--text-2)', marginTop: 4 }}>{e.text}</div>)}
        </div>
      )}
    </div>
  )
}
