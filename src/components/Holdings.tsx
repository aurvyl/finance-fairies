import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { compactMoney, pct, price } from '../engine/format'
import type { AssetClass, Holding, Snapshot } from '../engine/types'

type SortKey = 'symbol' | 'value' | 'day' | 'weight'
const CLASSES: (AssetClass | 'All')[] = ['All', 'Stock', 'Crypto', 'Fund', 'Bond', 'Cash']
const PLURAL: Record<string, string> = { All: 'All', Stock: 'Stocks', Crypto: 'Crypto', Fund: 'Funds', Bond: 'Bonds', Cash: 'Cash' }

function Path({ h }: { h: Holding }) {
  const p = h.path
  if (p.length < 2) return null
  const lo = Math.min(...p, h.open)
  const hi = Math.max(...p, h.open)
  const W = 72
  const H = 22
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)
  const d = p.map((v, i) => `${i ? 'L' : 'M'}${((i / (p.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg width={W} height={H} className={`path ${h.price >= h.open ? 'up' : 'down'}`} aria-hidden>
      <line x1={0} x2={W} y1={y(h.open)} y2={y(h.open)} className="path-open" />
      <path d={d} />
    </svg>
  )
}

export function Holdings({ s, compact }: { s: Snapshot; compact?: boolean }) {
  const [q, setQ] = useState('')
  const [cls, setCls] = useState<AssetClass | 'All'>('All')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'value', dir: -1 })
  const [all, setAll] = useState(!compact)

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: s.holdings.length }
    for (const h of s.holdings) c[h.assetClass] = (c[h.assetClass] ?? 0) + 1
    return c
  }, [s.holdings])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = s.holdings.filter(
      (h) => (cls === 'All' || h.assetClass === cls) && (!needle || h.symbol.toLowerCase().includes(needle) || h.name.toLowerCase().includes(needle)),
    )
    const key = (h: Holding) =>
      sort.k === 'symbol' ? h.symbol : sort.k === 'day' ? h.price / h.open - 1 : h.qty * h.price
    return list.sort((a, b) => {
      const x = key(a)
      const y = key(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [s.holdings, q, cls, sort])

  const shown = all ? rows : rows.slice(0, 12)

  const th = (k: SortKey, children: string, num?: boolean) => {
    const active = sort.k === k || (k === 'weight' && sort.k === 'value')
    const Icon = sort.dir === 1 ? ArrowUp : ArrowDown
    return (
      <th key={k} scope="col" className={num ? 'num' : ''} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button className={`sort ${active ? 'on' : ''}`} onClick={() => setSort((p) => ({ k: k === 'weight' ? 'value' : k, dir: p.k === (k === 'weight' ? 'value' : k) ? ((p.dir * -1) as 1 | -1) : k === 'symbol' ? 1 : -1 }))}>
          {children}
          <Icon size={12} aria-hidden className="sort-icon" />
        </button>
      </th>
    )
  }

  return (
    <div className="panel holdings">
      <header className="panel-head">
        <h2>Holdings</h2>
        <span className="muted">{s.holdings.length} positions, managed as one portfolio</span>
      </header>
      <div className="filters">
        <div className="chips" role="group" aria-label="Filter by asset class">
          {CLASSES.filter((c) => counts[c]).map((c) => (
            <button key={c} className="chip" aria-pressed={cls === c} onClick={() => setCls(c)}>
              {PLURAL[c]} <span className="count">{counts[c]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={14} aria-hidden />
          <span className="sr-only">Search holdings</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or name" />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {th('symbol', 'Holding')}
              <th scope="col" className="hide-sm">
                Sector
              </th>
              <th scope="col" className="num hide-sm">
                Price
              </th>
              {th('day', 'Today', true)}
              <th scope="col" className="hide-sm">
                <span className="sr-only">Intraday path</span>
              </th>
              {th('value', 'Value', true)}
              {th('weight', 'Weight', true)}
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => {
              const d = h.price / h.open - 1
              const v = h.qty * h.price
              return (
                <tr key={h.symbol}>
                  <td>
                    <span className="sym">{h.symbol}</span>
                    <span className="nm">{h.name}</span>
                  </td>
                  <td className="hide-sm muted">{h.sector}</td>
                  <td className="num hide-sm">{price(h.price)}</td>
                  <td className={`num ${d < 0 ? 'down' : 'up'}`}>{pct(d, 2)}</td>
                  <td className="hide-sm">
                    <Path h={h} />
                  </td>
                  <td className="num">{compactMoney(v)}</td>
                  <td className="num muted">{pct(v / s.value, 2, false)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No holdings match “{q}”. Try a ticker like NVDA or a name like Bitcoin.</p>}
      </div>
      {!all && rows.length > shown.length && (
        <button className="btn ghost show-all" onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
    </div>
  )
}
