import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clock, compactMoney, pct } from '../engine/format'
import type { Point, Snapshot } from '../engine/types'
import { useUI } from '../store'

export type Period = '1D' | '1W' | '1M' | '3M' | '1Y'
const DAYS: Record<Exclude<Period, '1D'>, number> = { '1W': 5, '1M': 21, '3M': 63, '1Y': 252 }

const PAD = { top: 18, right: 108, bottom: 26, left: 8 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(800)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function PortfolioChart({ s, period, height = 300 }: { s: Snapshot; period: Period; height?: number }) {
  const ui = useUI()
  const [wrap, width] = useWidth<HTMLDivElement>()
  const [hoverX, setHoverX] = useState<number | null>(null)

  const g = { ...s.guardrails, ...ui.preview }
  const floor = s.highWater * (1 - g.maxDrawdown)
  const dailyLine = s.open * (1 - g.dailyLoss)
  const dailyAct = s.open * (1 - g.dailyLoss * g.actAt)
  const floorAct = s.highWater * (1 - g.maxDrawdown * g.actAt)

  const intraday = period === '1D'
  const pts: Point[] = useMemo(() => {
    if (intraday) return s.intraday
    const n = DAYS[period]
    return [...s.daily.slice(-n), { t: s.now, v: s.value }]
  }, [intraday, period, s.intraday, s.daily, s.now, s.value])

  const x0 = intraday ? s.dayStart : pts[0].t
  const x1 = intraday ? s.dayEnd : s.now
  const vals = pts.map((p) => p.v)
  // the user's limit for this view is always in frame; the other one is pinned if it is far away
  // on 1D, bring the floor into frame too when it is close enough to matter today
  const floorNear = intraday && (s.open - floor) / s.open < g.dailyLoss * 2.5
  const must = intraday ? [dailyLine, s.open, ...(floorNear ? [floor] : [])] : [floor, s.highWater]
  let lo = Math.min(...vals, ...must)
  let hi = Math.max(...vals, ...must)
  const span = hi - lo || hi * 0.01
  lo -= span * 0.08
  hi += span * 0.1

  const W = width
  const H = height
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const sx = (t: number) => PAD.left + ((t - x0) / (x1 - x0 || 1)) * iw
  const sy = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih
  const clampY = (v: number) => Math.min(PAD.top + ih, Math.max(PAD.top, sy(v)))

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join('')
  const last = pts[pts.length - 1]
  const area = `${line}L${sx(last.t).toFixed(1)},${PAD.top + ih}L${sx(pts[0].t).toFixed(1)},${PAD.top + ih}Z`

  const markers = s.activity.filter((a) => a.kind === 'action' && a.t >= x0 && a.t <= x1)

  // hover: snap to the nearest point
  let hp: Point | null = null
  if (hoverX !== null) {
    let best = Infinity
    for (const p of pts) {
      const d = Math.abs(sx(p.t) - hoverX)
      if (d < best) {
        best = d
        hp = p
      }
    }
  }
  const base = intraday ? s.open : pts[0].v

  const guide = (v: number, label: string, sub: string, cls: string, dy = 0) => {
    const off = sy(v) > PAD.top + ih ? 'below' : sy(v) < PAD.top ? 'above' : null
    const y = clampY(v)
    return (
      <g className={`guide ${cls} ${off ? 'off' : ''}`} key={label}>
        <line x1={PAD.left} x2={PAD.left + iw} y1={y} y2={y} />
        <text x={PAD.left + iw + 10} y={y - 3 + dy} className="guide-label">
          {off === 'below' ? '↓ ' : off === 'above' ? '↑ ' : ''}
          {label}
        </text>
        <text x={PAD.left + iw + 10} y={y + 11 + dy} className="guide-sub">
          {sub}
        </text>
      </g>
    )
  }

  const yTicks = 4
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + ((hi - lo) * i) / yTicks)
  const xTicks = intraday
    ? [10, 11, 12, 13, 14, 15].map((h) => {
        const d = new Date(s.dayStart)
        d.setHours(h, 0, 0, 0)
        return d.getTime()
      })
    : Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / 5)

  // keep the two limit labels apart on 1D; the lines stay where they are
  let dailyDy = 0
  let floorDy = 0
  if (floorNear) {
    const gap = clampY(floor) - clampY(dailyLine)
    if (Math.abs(gap) < 30) {
      const push = (30 - Math.abs(gap)) / 2
      dailyDy = gap >= 0 ? -push : push
      floorDy = gap >= 0 ? push : -push
    }
  }

  const zoneTop = intraday ? dailyAct : floorAct
  const zoneBottom = intraday ? dailyLine : floor

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`Portfolio value ${period}, with your ${intraday ? 'daily loss limit' : 'maximum drop floor'} drawn as a line`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          setHoverX(e.clientX - r.left)
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
          </linearGradient>
          <pattern id="ward" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--limit)" strokeOpacity="0.22" strokeWidth="2" />
          </pattern>
        </defs>

        {ticks.map((v) => (
          <g key={v} className="grid">
            <line x1={PAD.left} x2={PAD.left + iw} y1={sy(v)} y2={sy(v)} />
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - 6} className="axis" textAnchor="middle">
            {intraday ? clock(t) : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </text>
        ))}

        {/* the agent's zone: between where it starts acting and the limit itself */}
        <rect
          className="ward"
          x={PAD.left}
          width={iw}
          y={clampY(zoneTop)}
          height={Math.max(0, clampY(zoneBottom) - clampY(zoneTop))}
          fill="url(#ward)"
        />

        {intraday && guide(s.open, 'Open', compactMoney(s.open), 'open')}
        {!intraday && guide(s.highWater, 'Peak', compactMoney(s.highWater), 'peak')}
        {intraday
          ? guide(dailyLine, `Daily limit ${pct(-g.dailyLoss, 1)}`, compactMoney(dailyLine), 'limit', dailyDy)
          : guide(floor, `Floor ${pct(-g.maxDrawdown, 0)}`, compactMoney(floor), 'limit')}
        {floorNear && guide(floor, `Floor ${pct(-g.maxDrawdown, 0)}`, compactMoney(floor), 'limit second', floorDy)}

        <path d={area} fill="url(#area)" className="area" />
        <path d={line} className="value-line" />

        {markers.map((m) => (
          <g
            key={m.id}
            className={`marker ${ui.hovered === m.id ? 'on' : ''} ${m.pending ? 'pending' : ''}`}
            transform={`translate(${sx(m.t)},${sy(m.value)})`}
            onPointerEnter={() => ui.setHovered(m.id)}
            onPointerLeave={() => ui.setHovered(null)}
            onClick={() => ui.setExpanded(m.id)}
          >
            <line y1={0} y2={PAD.top + ih - sy(m.value)} className="marker-stem" />
            <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" rx={1.5} />
            <title>{m.title}</title>
          </g>
        ))}

        {intraday && s.marketOpen && (
          <g className="head" transform={`translate(${sx(last.t)},${sy(last.v)})`}>
            <circle r={9} className="head-ring" />
            <circle r={3.5} className="head-dot" />
          </g>
        )}

        {hp && (
          <g className="cross">
            <line x1={sx(hp.t)} x2={sx(hp.t)} y1={PAD.top} y2={PAD.top + ih} />
            <circle cx={sx(hp.t)} cy={sy(hp.v)} r={4} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="tip"
          style={{ transform: `translate(${Math.min(Math.max(sx(hp.t) - 70, 0), W - PAD.right - 140)}px, ${Math.max(sy(hp.v) - 64, 0)}px)` }}
        >
          <span className="tip-t">
            {intraday ? clock(hp.t) : new Date(hp.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <strong>{compactMoney(hp.v)}</strong>
          <span className={hp.v >= base ? 'up' : 'down'}>{pct(hp.v / base - 1)}</span>
        </div>
      )}
    </div>
  )
}
