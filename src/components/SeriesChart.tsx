import { useLayoutEffect, useRef, useState } from 'react'
import { compactMoney, pct } from '../engine/format'

export interface Series {
  id: string
  label: string
  points: { t: string; v: number }[]
  className: string
}

export interface Mark {
  t: string
  id: string
  title: string
  tone?: 'act' | 'warn'
}

const PAD = { top: 16, right: 108, bottom: 26, left: 8 }

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(760)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const fmtDate = (t: string) => new Date(t + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * Daily lines for several strategies on one scale, with the user's floor drawn as a load line.
 * The first series is the one being judged and is drawn on top.
 */
export function SeriesChart({
  series,
  floor,
  floorLabel,
  marks = [],
  activeMark,
  onMark,
  height = 300,
}: {
  series: Series[]
  floor?: number
  floorLabel?: string
  marks?: Mark[]
  activeMark?: string | null
  onMark?: (id: string | null, click?: boolean) => void
  height?: number
}) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const dates = series[0]?.points.map((p) => p.t) ?? []
  if (dates.length < 2) return <div className="chart" ref={ref} style={{ height }} />

  const all = series.flatMap((s) => s.points.map((p) => p.v)).concat(floor !== undefined ? [floor] : [])
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  const span = hi - lo || hi * 0.01
  lo -= span * 0.08
  hi += span * 0.08
  const H = height
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const sx = (i: number) => PAD.left + (i / (dates.length - 1)) * iw
  const sy = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih
  const idx = new Map(dates.map((d, i) => [d, i]))
  const path = (s: Series) => s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join('')
  const ticks = (W < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => Math.round(f * (dates.length - 1)))
  const base = series[0].points[0].v

  // end labels, nudged apart and clear of the floor's two-line label
  const floorY = floor !== undefined ? sy(floor) : null
  let lastY = -Infinity
  const ends = series
    .map((s) => ({ s, y: sy(s.points[s.points.length - 1].v) }))
    .sort((a, b) => a.y - b.y)
    .map((e) => {
      let y = Math.max(e.y, lastY + 16)
      if (floorY !== null && y > floorY - 21 && y < floorY + 24) y = e.y < floorY && floorY - 21 >= lastY + 16 ? floorY - 21 : floorY + 24
      lastY = y
      return { ...e, ly: y }
    })

  return (
    <div className="chart" ref={ref}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`Value of ${series.map((s) => s.label).join(', ')} from ${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - PAD.left) / iw) * (dates.length - 1))
          setHover(Math.max(0, Math.min(dates.length - 1, i)))
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} className="gridline" x1={PAD.left} x2={PAD.left + iw} y1={PAD.top + f * ih} y2={PAD.top + f * ih} />
        ))}
        {ticks.map((i) => (
          <text key={i} className="axis" x={sx(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}>
            {fmtDate(dates[i])}
          </text>
        ))}
        {floor !== undefined && (
          <g className="guide limit">
            <line x1={PAD.left} x2={PAD.left + iw} y1={sy(floor)} y2={sy(floor)} />
            <text x={PAD.left + iw + 10} y={sy(floor) - 3} className="guide-label">
              {floorLabel ?? 'Floor'}
            </text>
            <text x={PAD.left + iw + 10} y={sy(floor) + 11} className="guide-sub">
              {compactMoney(floor)}
            </text>
          </g>
        )}
        {[...series].reverse().map((s) => (
          <path key={s.id} d={path(s)} className={`series ${s.className}`} />
        ))}
        {ends.map((e) => (
          <text key={e.s.id} x={PAD.left + iw + 10} y={e.ly + 4} className={`series-end ${e.s.className}`}>
            {e.s.label}
          </text>
        ))}
        {marks.map((m) => {
          const i = idx.get(m.t)
          if (i === undefined) return null
          const v = series[0].points[i].v
          return (
            <g
              key={m.id}
              className={`marker ${activeMark === m.id ? 'on' : ''} ${m.tone === 'warn' ? 'pending' : ''}`}
              transform={`translate(${sx(i)},${sy(v)})`}
              onPointerEnter={() => onMark?.(m.id)}
              onPointerLeave={() => onMark?.(null)}
              onClick={() => onMark?.(m.id, true)}
            >
              <line y1={0} y2={PAD.top + ih - sy(v)} className="marker-stem" />
              <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" rx={1.5} />
              <title>{m.title}</title>
            </g>
          )
        })}
        {hover !== null && (
          <g className="cross">
            <line x1={sx(hover)} x2={sx(hover)} y1={PAD.top} y2={PAD.top + ih} />
            {series.map((s) => (
              <circle key={s.id} cx={sx(hover)} cy={sy(s.points[hover].v)} r={3.5} className={s.className} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ transform: `translate(${Math.min(Math.max(sx(hover) - 80, 0), W - PAD.right - 170)}px, 4px)` }}>
          <span className="tip-t">{fmtDate(dates[hover])}</span>
          {series.map((s) => (
            <span key={s.id} className="tip-row">
              <i className={`tip-key ${s.className}`} aria-hidden />
              {s.label}
              <strong>{pct(s.points[hover].v / base - 1, 1)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
