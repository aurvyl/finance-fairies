import { ArrowDown, Check, Hand, Pause, ShieldCheck, X } from 'lucide-react'
import { compactMoney, pct } from '../engine/format'
import { sim } from '../engine/sim'
import type { ActivityItem, Snapshot } from '../engine/types'
import { useUI } from '../store'
import { DECISION_LABEL, decisionOf, riskChange, soldAmount, type Decision } from './decision'

interface Lane {
  key: 'daily' | 'peak'
  name: string
  hint: string
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
    return { key, name, hint, used: loss / limit, trimAt, sellAt, roomToTrim: s.value - trimAt, roomToSell: s.value - sellAt }
  }
  return [
    mk('daily', 'Today', `Most you’ll lose in a day: ${pct(g.dailyLoss, 1, false)}`, s.open, g.dailyLoss),
    mk('peak', 'From your best day', `Most you’ll fall from your peak: ${pct(g.maxDrawdown, 0, false)}`, s.highWater, g.maxDrawdown),
  ]
}

function LaneBar({ l, actAt }: { l: Lane; actAt: number }) {
  const at = Math.min(1, Math.max(0, l.used))
  const zone = l.used >= 1 ? 'sell' : l.used >= actAt ? 'trim' : 'safe'
  return (
    <div className={`lane zone-${zone}`}>
      <div className="lane-head">
        <h3>{l.name}</h3>
        <span className="lane-hint">{l.hint}</span>
      </div>
      <div
        className="lane-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(at * 100)}
        aria-label={`${l.name}: ${pct(at, 0, false)} of your limit used`}
      >
        <div className="lane-safe" style={{ width: `${actAt * 100}%` }} />
        <div className="lane-trim" style={{ left: `${actAt * 100}%`, width: `${(1 - actAt) * 100}%` }} />
        <div className="lane-pin" style={{ left: `${at * 100}%` }}>
          <span>You</span>
        </div>
      </div>
      <div className="lane-marks">
        <div className="lane-mark start">
          <strong>Now</strong>
          <span>{l.used <= 0.005 ? 'No loss yet' : `${pct(Math.min(at, 1), 0, false)} of limit used`}</span>
        </div>
        <div className="lane-mark trim" style={{ left: `${actAt * 100}%` }}>
          <strong>Fairy starts selling</strong>
          <span>{l.roomToTrim > 0 ? `${compactMoney(l.roomToTrim)} away` : 'Passed'}</span>
        </div>
        <div className="lane-mark sell">
          <strong>Hard sell-off</strong>
          <span>{l.roomToSell > 0 ? `at ${compactMoney(l.sellAt)}, ${compactMoney(l.roomToSell)} away` : 'Reached'}</span>
        </div>
      </div>
    </div>
  )
}

/** The user's limits as two roads: how far they are from the fairy acting, and from the hard sell-off. */
export function SafetyPanel({ s }: { s: Snapshot }) {
  const ui = useUI()
  const ls = lanes(s, ui.preview)
  const a = s.guardrails.actAt
  const worst = ls.reduce((w, l) => (l.used > w.used ? l : w))
  const near = ls.reduce((w, l) => (l.roomToTrim < w.roomToTrim ? l : w))
  const zone = worst.used >= 1 ? 'sell' : worst.used >= a ? 'trim' : 'safe'
  const headline =
    zone === 'sell'
      ? 'Hard sell-off reached. Your fairy moved most of your money somewhere safe.'
      : zone === 'trim'
        ? 'Your fairy is protecting you by selling the riskiest holdings.'
        : `You’re safe. You can lose ${compactMoney(near.roomToTrim)} more before your fairy steps in.`
  const Icon = zone === 'safe' ? ShieldCheck : ArrowDown
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
      <div className="lanes">
        {ls.map((l) => (
          <LaneBar key={l.key} l={l} actAt={a} />
        ))}
      </div>
    </section>
  )
}

const RISK_MAX = 1.6
/** beta as a plain word: what a 10% market fall would roughly cost */
const riskWord = (b: number) => `${pct(b * 0.1, 1, false)}`

const ICON: Record<Decision, typeof ArrowDown> = { sell: ArrowDown, ask: Hand, hold: Pause }

function UsedBar({ label, v, text, after }: { label: string; v: number; text?: string; after?: boolean }) {
  return (
    <div className={`used-bar ${after ? 'after' : ''}`}>
      <span>{label}</span>
      <div className="used-track">
        <div style={{ width: `${Math.min(1, v) * 100}%` }} />
      </div>
      <b>{text ?? pct(Math.min(v, 1), 0, false)}</b>
    </div>
  )
}

function DecisionCard({ a }: { a: ActivityItem }) {
  const ui = useUI()
  const d = decisionOf(a)
  const Icon = ICON[d]
  const sold = soldAmount(a)
  const what = a.rule === 'daily' ? 'today’s limit' : 'your peak limit'
  const amt = sold > 0 ? compactMoney(sold) : (/Moved (\$[\d.,]+[kM]?)/.exec(a.summary)?.[1] ?? '')
  const title = d === 'sell' ? `Sold ${amt}`.trim() : d === 'ask' ? `Wants to sell ${amt}`.trim() : a.title.startsWith('Declined') ? 'You said no, so it held' : 'Held, no trades'
  const sub =
    d === 'sell' ? `Moved into safe Treasuries to protect ${what}` : d === 'ask' ? `To protect ${what}. Waiting for your OK.` : holdNote(a)
  const risk = d === 'ask' ? null : riskChange(a)
  const symbols = (a.trades ?? []).filter((t) => t.side === 'Sell').map((t) => t.symbol)
  return (
    <li
      className={`decision d-${d} ${ui.hovered === a.id ? 'hover' : ''}`}
      onPointerEnter={() => ui.setHovered(a.id)}
      onPointerLeave={() => ui.setHovered(null)}
    >
      <span className="decision-icon" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="decision-body">
        <p className="decision-tag">{DECISION_LABEL[d]}</p>
        <h3>{title}</h3>
        <p className="muted">{sub}</p>
        {symbols.length > 0 && (
          <ul className="chips" aria-label="Holdings sold">
            {symbols.slice(0, 5).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {risk ? (
          <div className="before-after" aria-label="How much a market fall would hurt, before and after">
            <p className="ba-head">You’d lose if markets fell 10%</p>
            <UsedBar label="Before" v={risk[0] / RISK_MAX} text={riskWord(risk[0])} />
            <UsedBar label="After" after v={risk[1] / RISK_MAX} text={riskWord(risk[1])} />
          </div>
        ) : (
          a.usedBefore !== undefined && (
            <div className="before-after" aria-label="Share of your limit used">
              <p className="ba-head">Limit used</p>
              <UsedBar label="Then" v={a.usedBefore} />
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

/** The agent's recent decisions as pictures: what it did, and how much of the limit it gave back. */
export function Decisions({ s }: { s: Snapshot }) {
  const items = s.activity.filter((a) => a.kind === 'action').slice(0, 3)
  return (
    <section className="panel decisions" aria-labelledby="dec-h">
      <header className="panel-head">
        <h2 id="dec-h">What your fairy decided</h2>
        <ul className="dec-key" aria-label="Key">
          {(['sell', 'ask', 'hold'] as Decision[]).map((d) => {
            const I = ICON[d]
            return (
              <li key={d} className={`d-${d}`}>
                <span className="decision-icon xs" aria-hidden>
                  <I size={11} />
                </span>
                {DECISION_LABEL[d]}
              </li>
            )
          })}
        </ul>
      </header>
      {items.length === 0 ? (
        <ul className="decision-list">
          <li className="decision d-hold">
            <span className="decision-icon" aria-hidden>
              <ShieldCheck size={18} />
            </span>
            <div className="decision-body">
              <p className="decision-tag">Holding</p>
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
