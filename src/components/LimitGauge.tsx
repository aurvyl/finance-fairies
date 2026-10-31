import { compactMoney, pct } from '../engine/format'
import type { Snapshot } from '../engine/types'
import { useUI } from '../store'

export interface LimitLine {
  key: 'dailyLoss' | 'maxDrawdown'
  name: string
  /** portfolio value at which the limit is hit */
  at: number
  /** portfolio value at which the agent starts reducing risk */
  actAt: number
  /** how far the portfolio can fall from now before the limit, as a fraction of today's value */
  room: number
  roomActs: number
}

/** Both of the user's limits, expressed the same way: how far the portfolio can fall from here. */
export function limitLines(s: Snapshot, preview: { dailyLoss?: number; maxDrawdown?: number } = {}): LimitLine[] {
  const g = { ...s.guardrails, ...preview }
  const mk = (key: LimitLine['key'], name: string, base: number, limit: number): LimitLine => {
    const at = base * (1 - limit)
    const actAt = base * (1 - limit * g.actAt)
    return { key, name, at, actAt, room: 1 - at / s.value, roomActs: 1 - actAt / s.value }
  }
  return [mk('dailyLoss', 'Daily loss limit', s.open, g.dailyLoss), mk('maxDrawdown', 'Maximum drop', s.highWater, g.maxDrawdown)].sort((a, b) => a.room - b.room)
}

const H = 232
const LABEL_GAP = 40

/**
 * A sounding line. "Now" sits at the waterline at the top; each limit is drawn at its true depth
 * below it on one shared scale, with the band where the agent steps in hatched above it.
 * The nearer limit is the one that matters, so it leads.
 */
export function LimitGauge({ s }: { s: Snapshot }) {
  const ui = useUI()
  const lines = limitLines(s, ui.preview)
  const deepest = Math.max(...lines.map((l) => l.room), 0.01)
  const depth = Math.max(0.02, Math.ceil(deepest * 1.12 * 100) / 100)
  const y = (room: number) => Math.min(H, Math.max(0, (room / depth) * H))

  // whole-percent ticks, thinned when the scale is deep
  const step = depth > 0.12 ? 0.05 : depth > 0.06 ? 0.02 : 0.01
  const ticks: number[] = []
  for (let t = step; t < depth - step * 0.3; t += step) ticks.push(t)

  // keep labels from colliding while the lines stay at their true depth
  let last = -Infinity
  const labelY = lines.map((l) => {
    const want = Math.max(y(l.room), 0)
    const at = Math.max(want, last + LABEL_GAP)
    last = at
    return at
  })

  return (
    <div className="gauge" style={{ height: H + 24 }}>
      <div className="gauge-scale" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ top: y(t) }}>
            {pct(-t, 0)}
          </span>
        ))}
      </div>
      <div className="gauge-track" style={{ height: H }}>
        <div className="gauge-now" aria-hidden />
        {ticks.map((t) => (
          <i key={t} className="gauge-tick" style={{ top: y(t) }} aria-hidden />
        ))}
        {lines.map((l, i) => (
          <div key={l.key} className={`gauge-limit ${i === 0 ? 'lead' : ''} ${l.room <= 0 ? 'hit' : ''}`}>
            <div className="gauge-ward" style={{ top: y(l.roomActs), height: Math.max(2, y(l.room) - y(l.roomActs)) }} aria-hidden />
            <div className="gauge-line" style={{ top: y(l.room) }} aria-hidden />
          </div>
        ))}
      </div>
      <div className="gauge-labels">
        <div className="gauge-now-label">
          <strong>Now</strong> {compactMoney(s.value)}
        </div>
        {lines.map((l, i) => (
          <div
            key={l.key}
            className={`gauge-label ${i === 0 ? 'lead' : ''} ${l.room <= 0 ? 'hit' : ''}`}
            style={{ top: labelY[i] }}
          >
            <span className="gauge-name">{l.name}</span>
            <span className="gauge-room">
              {l.room <= 0 ? 'Reached' : `${pct(l.room, 2, false)} · ${compactMoney(s.value - l.at)}`}
            </span>
            <span className="gauge-at">at {compactMoney(l.at)}</span>
            <span className="gauge-at gauge-away">{l.room > 0 ? 'away' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
