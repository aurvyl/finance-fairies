import { Activity as Swings, ArrowDown, CalendarDays, Check, Hand, OctagonAlert, Pause, ShieldCheck, TrendingDown, X } from 'lucide-react'
import { compactMoney, pct } from '../engine/format'
import { sim } from '../engine/sim'
import type { ActivityItem, Snapshot } from '../engine/types'
import { useUI } from '../store'
import { decisionOf, riskChange, soldAmount, type Decision } from './decision'
import { FairyMark } from './FairyAvatar'
import './visuals.css'

interface Lane {
  key: 'daily' | 'peak'
  name: string
  hint: string
  /** the user's limit, as a fraction */
  limit: number
  /** share of the limit used so far, 0..1+ */
  used: number
  trimAt: number
  sellAt: number
  roomToTrim: number
  roomToSell: number
}

function lanes(s: Snapshot, preview: { dailyLoss?: number; maxDrawdown?: number }): Lane[] {
  const g = { ...s.guardrails, ...preview }
  const mk = (key: Lane['key'], name: string, hint: string, base: number, limit: number): Lane => {
    const loss = Math.max(0, 1 - s.value / base)
    const trimAt = base * (1 - limit * g.actAt)
    const sellAt = base * (1 - limit)
    return { key, name, hint, limit, used: loss / limit, trimAt, sellAt, roomToTrim: s.value - trimAt, roomToSell: s.value - sellAt }
  }
  return [
    mk('daily', 'Today', 'Your daily limit', s.open, g.dailyLoss),
    mk('peak', 'From your best day', 'Your limit from your peak', s.highWater, g.maxDrawdown),
  ]
}

const R = 80
const CX = 100
const CY = 96
/** a point on the half dial: t = 0 on the left, 1 on the right */
const at = (t: number, r = R) => {
  const a = Math.PI * (1 - t)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const
}
const arc = (t0: number, t1: number) => {
  const [x0, y0] = at(t0)
  const [x1, y1] = at(t1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

const ZONE_WORD = { safe: 'Plenty of room', trim: 'Fairy is selling', sell: 'Limit reached' } as const
const ZONE_ICON = { safe: ShieldCheck, trim: ArrowDown, sell: OctagonAlert } as const

const laneZone = (l: Lane, actAt: number) => (l.used >= 1 ? 'sell' : l.used >= actAt ? 'trim' : 'safe')

const laneTip = (l: Lane, actAt: number) =>
  [
    `${l.name} (limit ${pct(l.limit, 1, false)}): ${l.used <= 0.005 ? 'no loss yet' : `${pct(Math.min(l.used, 1), 0, false)} of your limit used`}.`,
    `Your fairy steps in at ${pct(actAt, 0, false)} of the limit (${compactMoney(l.trimAt)}${l.roomToTrim > 0 ? `, ${compactMoney(l.roomToTrim)} away` : ', passed'}).`,
    `Hard sell-off at ${compactMoney(l.sellAt)}${l.roomToSell > 0 ? `, ${compactMoney(l.roomToSell)} away` : ', reached'}.`,
  ].join(' ')

/** One limit as a half dial: the needle walks from calm teal into the amber band where the fairy acts, and stops at the coral end. */
function LaneGauge({ l, actAt }: { l: Lane; actAt: number }) {
  const t = Math.min(1, Math.max(0, l.used))
  const zone = laneZone(l, actAt)
  const Icon = ZONE_ICON[zone]
  const [nx, ny] = at(t)
  const [fx, fy] = at(actAt, R + 20)
  const tick = (u: number, r0: number, r1: number) => {
    const [x0, y0] = at(u, r0)
    const [x1, y1] = at(u, r1)
    return { x1: x0, y1: y0, x2: x1, y2: y1 }
  }
  return (
    <div className={`dial zone-${zone}`} title={laneTip(l, actAt)}>
      <div className="dial-art">
        <svg
          viewBox="0 0 200 106"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(t * 100)}
          aria-label={laneTip(l, actAt)}
        >
          <path d={arc(0, actAt)} className="dial-safe" />
          <path d={arc(actAt, 1)} className="dial-trim" />
          {t > 0.005 && <path d={arc(0, t)} className="dial-fill" />}
          <line {...tick(actAt, R - 12, R + 12)} className="dial-tick" />
          <line {...tick(1, R - 12, R + 12)} className="dial-end" />
          <circle cx={nx} cy={ny} r="9" className="dial-pin" />
        </svg>
        <span className="dial-fairy" style={{ left: `${(fx / 200) * 100}%`, top: `${(fy / 106) * 100}%` }} aria-hidden>
          <FairyMark size={18} />
        </span>
        <div className="dial-center">
          <span className="dial-icon" aria-hidden>
            <Icon size={18} />
          </span>
          <strong>{ZONE_WORD[zone]}</strong>
        </div>
      </div>
      <p className="dial-name">{l.name}</p>
      <p className="dial-hint">{l.hint}</p>
    </div>
  )
}


/** The user's limits as two dials, plus how fast things are moving. Exact numbers live in tooltips and the details view. */
export function SafetyPanel({ s }: { s: Snapshot }) {
  const ui = useUI()
  const ls = lanes(s, ui.preview)
  const a = s.guardrails.actAt
  const worst = ls.reduce((w, l) => (l.used > w.used ? l : w))
  const near = ls.reduce((w, l) => (l.roomToTrim < w.roomToTrim ? l : w))
  const zone = laneZone(worst, a)
  const headline =
    zone === 'sell'
      ? 'Hard sell-off reached. Your fairy moved most of your money somewhere safe.'
      : zone === 'trim'
        ? 'Your fairy is protecting you by selling the riskiest holdings.'
        : `You’re safe. You can lose ${compactMoney(near.roomToTrim)} more before your fairy steps in.`
  const Icon = ZONE_ICON[zone]
  const checks = speedChecks(s)
  return (
    <section className={`panel safety zone-${zone}`} aria-labelledby="safety-h">
      <header className="safety-head">
        <span className="safety-icon" aria-hidden>
          <Icon size={20} />
        </span>
        <div>
          <h2 id="safety-h">{headline}</h2>
          <p className="muted">{s.autonomy === 'paused' ? 'Your fairy is paused, so it will only watch.' : s.autonomy === 'ask' ? 'Your fairy will ask you before it sells.' : 'Your fairy sells on its own and tells you why.'}</p>
        </div>
        <button className="btn ghost sm" onClick={() => ui.setView('guardrails')}>
          Change limits
        </button>
      </header>
      <div className="safety-body">
        {ls.map((l) => (
          <LaneGauge key={l.key} l={l} actAt={a} />
        ))}
        <SpeedMeters checks={checks} />
      </div>
      <ul className="dial-key" aria-label="Key">
        <li>
          <i className="k-safe" /> Calm
        </li>
        <li>
          <span className="k-fairy" aria-hidden>
            <FairyMark size={14} />
          </span>
          Fairy steps in
        </li>
        <li>
          <i className="k-trim" /> Fairy sells some
        </li>
        <li>
          <i className="k-end" /> Hard sell-off
        </li>
      </ul>
      <details className="exact">
        <summary>See the exact numbers</summary>
        <table className="table exact-table">
          <tbody>
            {ls.map((l) => (
              <tr key={l.key}>
                <th scope="row">{l.name}</th>
                <td>
                  {l.used <= 0.005 ? 'No loss yet' : `${pct(Math.min(l.used, 1), 0, false)} of your ${pct(l.limit, l.key === 'daily' ? 1 : 0, false)} limit used`}
                </td>
                <td>
                  Fairy steps in at {pct(a, 0, false)}: {l.roomToTrim > 0 ? `${compactMoney(l.roomToTrim)} away` : 'passed'}
                </td>
                <td>
                  Hard sell-off at {compactMoney(l.sellAt)}: {l.roomToSell > 0 ? `${compactMoney(l.roomToSell)} away` : 'reached'}
                </td>
              </tr>
            ))}
            {checks.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.name}</th>
                <td>{c.now}</td>
                <td colSpan={2}>{c.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

type Check = { key: string; name: string; short: string; icon: typeof Swings; now: string; line: string; hit: boolean; fill: number }

/** The engine's rate-of-fall checks (engine/guardian/triggers.py), shown on the live book. */
function speedChecks(s: Snapshot): Check[] {
  const day = s.value / s.open - 1
  const worst = s.holdings.filter((h) => h.open > 0 && h.assetClass !== 'Cash').reduce<{ sym: string; r: number }>(
    (w, h) => (h.price / h.open - 1 < w.r ? { sym: h.symbol, r: h.price / h.open - 1 } : w),
    { sym: '', r: 0 },
  )
  const closes = [...s.daily.map((p) => p.v), s.value]
  const rets = closes.slice(1).map((v, i) => v / closes[i] - 1)
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, x) => a + x, 0) / xs.length
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
  }
  const ratio = rets.length >= 20 ? sd(rets.slice(-5)) / Math.max(1e-9, sd(rets.slice(-60))) : NaN
  return [
    { key: 'day', name: 'Today’s fall', short: 'Today', icon: CalendarDays, now: pct(day), line: `limit ${pct(-s.guardrails.dailyLoss, 1)}`, hit: day <= -s.guardrails.dailyLoss, fill: Math.max(0, -day) / s.guardrails.dailyLoss },
    { key: 'stock', short: 'One holding', name: worst.sym ? `Worst holding (${worst.sym})` : 'Worst holding', icon: TrendingDown, now: pct(worst.r), line: 'flag at −7%', hit: worst.r <= -0.07, fill: Math.max(0, -worst.r) / 0.07 },
    { key: 'vol', name: 'Swings vs normal', short: 'Swings', icon: Swings, now: Number.isFinite(ratio) ? `${ratio.toFixed(1)}×` : '—', line: 'flag at 1.8×', hit: ratio >= 1.8, fill: Number.isFinite(ratio) ? ratio / 1.8 : 0 },
  ]
}

/** The flag sits at this share of each track, so a check that blows past it still has room to show it. */
const FLAG = 0.8

function SpeedMeters({ checks }: { checks: Check[] }) {
  const hits = checks.filter((c) => c.hit).length
  return (
    <div className="speed" role="group" aria-labelledby="speed-h">
      <p className="speed-head" id="speed-h">
        How fast it’s falling
        <span className={`speed-sum ${hits ? 'hit' : ''}`}>{hits ? 'Falling fast' : 'Steady'}</span>
      </p>
      <ul>
        {checks.map((c) => {
          const tip = `${c.name}: ${c.now}, ${c.line}`
          return (
            <li key={c.key} className={c.hit ? 'hit' : ''} title={tip}>
              <c.icon size={15} aria-hidden />
              <span className="speed-name">{c.short}</span>
              <span className="speed-track" role="meter" aria-label={tip} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, c.fill) * 100)}>
                <span className="speed-fill" style={{ width: `${Math.min(1, c.fill * FLAG) * 100}%` }} />
                <span className="speed-flag" style={{ left: `${FLAG * 100}%` }} />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const ICON: Record<Decision, typeof ArrowDown> = { sell: ArrowDown, ask: Hand, hold: Pause }

/** How much a sale cut market risk, in words: the bars carry the size. */
const cutWord = (b: number, a: number) => {
  const cut = 1 - a / b
  return cut >= 0.3 ? 'Risk down a lot' : cut >= 0.1 ? 'Risk down' : cut > 0 ? 'Risk down a little' : 'Risk about the same'
}

function DecisionCard({ a }: { a: ActivityItem }) {
  const ui = useUI()
  const d = decisionOf(a)
  const Icon = ICON[d]
  const sold = soldAmount(a)
  const what = a.rule === 'daily' ? 'today’s limit' : 'your peak limit'
  const amt = sold > 0 ? compactMoney(sold) : (/Moved (\$[\d.,]+[kM]?)/.exec(a.summary)?.[1] ?? '')
  const title = d === 'sell' ? `Sold ${amt}`.trim() : d === 'ask' ? `Wants to sell ${amt}`.trim() : a.title.startsWith('Declined') ? 'You said no, so it held' : 'Held, no trades'
  const sub = d === 'sell' ? 'Moved to safe Treasuries' : d === 'ask' ? 'Waiting for your OK' : holdNote(a)
  const risk = d === 'ask' ? null : riskChange(a)
  const symbols = (a.trades ?? []).filter((t) => t.side === 'Sell').map((t) => t.symbol)
  const tip = [
    d !== 'hold' ? `To protect ${what}.` : '',
    symbols.length ? `Sold: ${symbols.join(', ')}.` : '',
    risk ? `If markets fell 10% you’d lose ${pct(risk[0] * 0.1, 1, false)} before and ${pct(risk[1] * 0.1, 1, false)} after.` : '',
    a.usedBefore !== undefined ? `${pct(Math.min(a.usedBefore, 1), 0, false)} of the limit was used.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li
      className={`decision d-${d} ${ui.hovered === a.id ? 'hover' : ''}`}
      title={tip || undefined}
      onPointerEnter={() => ui.setHovered(a.id)}
      onPointerLeave={() => ui.setHovered(null)}
    >
      <span className="decision-icon" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="decision-body">
        <h3>{title}</h3>
        <p className="muted">{sub}</p>
        {risk ? (
          <div className="risk-shrink" role="img" aria-label={tip}>
            <span className="risk-bars">
              <span className="risk-before" style={{ width: '100%' }} />
              <span className="risk-after" style={{ width: `${Math.min(1, risk[1] / risk[0]) * 100}%` }} />
            </span>
            <span className="risk-word">{cutWord(risk[0], risk[1])}</span>
          </div>
        ) : (
          a.usedBefore !== undefined && (
            <div className="risk-shrink" role="img" aria-label={tip}>
              <span className="risk-bars">
                <span className="risk-used" style={{ width: `${Math.min(1, a.usedBefore) * 100}%` }} />
              </span>
              <span className="risk-word">Limit used then</span>
            </div>
          )
        )}
        {a.pending && (
          <div className="row-actions">
            <button className="btn solid sm" onClick={() => sim.approve(a.id)}>
              <Check size={14} aria-hidden /> Yes, sell
            </button>
            <button className="btn ghost sm" onClick={() => sim.dismiss(a.id)}>
              <X size={14} aria-hidden /> No
            </button>
          </div>
        )}
        <button
          className="link"
          onClick={() => {
            ui.setExpanded(a.id)
            ui.setView('activity')
          }}
        >
          Why?
        </button>
      </div>
    </li>
  )
}

const holdNote = (a: ActivityItem) => (a.summary.startsWith('You paused') ? 'You paused your fairy, so it only watched.' : 'Nothing needed doing.')

/** The agent's recent decisions as pictures: what it did, and how much market risk it took off. */
export function Decisions({ s }: { s: Snapshot }) {
  const items = s.activity.filter((a) => a.kind === 'action').slice(0, 3)
  return (
    <section className="panel decisions" aria-labelledby="dec-h">
      <header className="panel-head">
        <h2 id="dec-h">What your fairy decided</h2>
      </header>
      {items.length === 0 ? (
        <ul className="decision-list">
          <li className="decision d-hold">
            <span className="decision-icon" aria-hidden>
              <ShieldCheck size={18} />
            </span>
            <div className="decision-body">
              <h3>No trades needed yet</h3>
              <p className="muted">Your fairy is watching. Press “Simulate a sell-off” to see it act.</p>
            </div>
          </li>
        </ul>
      ) : (
        <ol className="decision-list">
          {items.map((a) => (
            <DecisionCard key={a.id} a={a} />
          ))}
        </ol>
      )}
    </section>
  )
}
