import { pct } from '../engine/format'
import type { Sector, Snapshot } from '../engine/types'

/** Muted chart-ink series, ordered light to dark so neighbours stay distinguishable. */
const SERIES: Record<Sector, string> = {
  Technology: 'oklch(0.36 0.07 255)',
  Semiconductors: 'oklch(0.46 0.09 240)',
  Financials: 'oklch(0.55 0.07 220)',
  Healthcare: 'oklch(0.63 0.08 195)',
  Energy: 'oklch(0.7 0.09 85)',
  Consumer: 'oklch(0.62 0.08 55)',
  Industrials: 'oklch(0.55 0.04 260)',
  Crypto: 'oklch(0.5 0.13 300)',
  'Global equity': 'oklch(0.72 0.05 230)',
  Bonds: 'oklch(0.8 0.04 200)',
  Cash: 'oklch(0.87 0.02 230)',
}

export function Allocation({ s }: { s: Snapshot }) {
  const by = new Map<Sector, { v: number; o: number; n: number }>()
  for (const h of s.holdings) {
    const e = by.get(h.sector) ?? { v: 0, o: 0, n: 0 }
    e.v += h.qty * h.price
    e.o += h.qty * h.open
    e.n++
    by.set(h.sector, e)
  }
  const rows = [...by.entries()].map(([sector, e]) => ({ sector, w: e.v / s.value, d: e.v / e.o - 1, n: e.n })).sort((a, b) => b.w - a.w)

  return (
    <div className="panel allocation">
      <header className="panel-head">
        <h2>Where your money is</h2>
      </header>
      <div className="stack" role="img" aria-label="Allocation by sector">
        {rows.map((r) => (
          <span key={r.sector} style={{ flexGrow: r.w, background: SERIES[r.sector] }} title={`${r.sector} ${pct(r.w, 1, false)}`} />
        ))}
      </div>
      <table className="alloc">
        <thead>
          <tr>
            <th scope="col">Sector</th>
            <th scope="col" className="num">
              Weight
            </th>
            <th scope="col" className="num">
              Today
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sector}>
              <td>
                <span className="swatch" style={{ background: SERIES[r.sector] }} aria-hidden />
                {r.sector}
                <span className="count">{r.n}</span>
              </td>
              <td className="num">{pct(r.w, 1, false)}</td>
              <td className={`num ${r.d < 0 ? 'down' : 'up'}`}>{pct(r.d, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
