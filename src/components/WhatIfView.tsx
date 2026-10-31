import { FlaskConical, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { engine } from '../api/client'
import { approvalLabel, rulesFor } from '../api/portfolio'
import { useSettings } from '../api/settings'
import { useConnection, useRequest } from '../api/useEngine'
import { pct } from '../engine/format'
import type { Snapshot } from '../engine/types'
import { useUI } from '../store'
import { AttributionBar, PlanDetails } from './PlanDetails'

interface Shock {
  ticker: string
  move: string
}

const PRESETS: { label: string; shocks: Shock[] }[] = [
  { label: 'NVIDIA falls 12%', shocks: [{ ticker: 'NVDA', move: '-12' }] },
  { label: 'Chip rout', shocks: [{ ticker: 'NVDA', move: '-10' }, { ticker: 'AMD', move: '-9' }, { ticker: 'AVGO', move: '-8' }] },
  { label: 'Big tech slide', shocks: [{ ticker: 'MSFT', move: '-6' }, { ticker: 'GOOGL', move: '-7' }, { ticker: 'META', move: '-8' }, { ticker: 'AMZN', move: '-6' }] },
]

export function WhatIfView({ s }: { s: Snapshot }) {
  const conn = useConnection()
  const settings = useSettings()
  const ui = useUI()
  const [date, setDate] = useState('2026-10-30')
  const [shocks, setShocks] = useState<Shock[]>(PRESETS[0].shocks)
  const [req, run] = useRequest(engine.analyze)
  const online = conn.state === 'online'
  const result = useRef<HTMLElement>(null)

  // on one-column layouts the answer lands below the form, so bring it into view
  useEffect(() => {
    if (req.status === 'done' && window.matchMedia('(max-width: 1180px)').matches) result.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [req.status])

  const inject = Object.fromEntries(
    shocks.filter((x) => x.ticker.trim() && x.move.trim() && !isNaN(parseFloat(x.move))).map((x) => [x.ticker.trim().toUpperCase(), parseFloat(x.move) / 100]),
  )
  const valid = Object.keys(inject).length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)
  const go = () => void run({ ...rulesFor(s), date, inject })

  return (
    <div className="grid two">
      <section className="panel" aria-labelledby="wi-h">
        <header className="panel-head">
          <h2 id="wi-h">What if the market did this?</h2>
        </header>
        <p className="lede">Pick a day and replace some of that day’s moves. The engine works out what Guardian would do, checks the plan, and says whether it would trade on its own or ask you first.</p>

        <div className="chips presets" role="group" aria-label="Example shocks">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip" onClick={() => setShocks(p.shocks)}>
              {p.label}
            </button>
          ))}
        </div>

        <form
          className="whatif-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && online) go()
          }}
        >
          <label className="field">
            <span>Day</span>
            <input type="date" value={date} min="2023-12-01" max="2026-10-30" onChange={(e) => setDate(e.target.value)} />
          </label>
          <fieldset className="shocks">
            <legend>Moves on that day</legend>
            {shocks.map((x, i) => (
              <div className="shock" key={i}>
                <label className="field">
                  <span className="sr-only">Ticker {i + 1}</span>
                  <input value={x.ticker} placeholder="Ticker" autoCapitalize="characters" onChange={(e) => setShocks(shocks.map((y, j) => (j === i ? { ...y, ticker: e.target.value } : y)))} />
                </label>
                <label className="field pct-field">
                  <span className="sr-only">Move for ticker {i + 1}, percent</span>
                  <input inputMode="decimal" value={x.move} placeholder="−10" onChange={(e) => setShocks(shocks.map((y, j) => (j === i ? { ...y, move: e.target.value } : y)))} />
                  <span className="suffix" aria-hidden>
                    %
                  </span>
                </label>
                <button type="button" className="icon-btn" aria-label={`Remove ${x.ticker || 'this move'}`} onClick={() => setShocks(shocks.filter((_, j) => j !== i))}>
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost sm" onClick={() => setShocks([...shocks, { ticker: '', move: '' }])}>
              <Plus size={14} aria-hidden /> Add a move
            </button>
          </fieldset>
          <div className="row-actions start">
            <button className="btn solid" disabled={!valid || !online || req.status === 'loading'}>
              <FlaskConical size={15} aria-hidden />
              {req.status === 'loading' ? (settings.useAgent ? 'Asking the agent…' : 'Working it out…') : 'See what Guardian would do'}
            </button>
          </div>
          {!online && (
            <p className="notice">
              This needs the engine running.{' '}
              <button type="button" className="link" onClick={() => ui.setView('settings')}>
                Engine settings
              </button>
            </p>
          )}
        </form>
      </section>

      <section className="panel" ref={result} aria-labelledby="wi-r" aria-busy={req.status === 'loading'}>
        <header className="panel-head">
          <h2 id="wi-r">Guardian’s decision</h2>
        </header>
        {req.status === 'idle' && <p className="empty">Run a scenario to see the trigger, the plans the engine checked, and whether it would ask you first.</p>}
        {req.status === 'loading' && (
          <div className="skeleton block" aria-label="Loading">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {req.status === 'error' && (
          <div className="notice error" role="alert">
            <p>
              <strong>The engine couldn’t answer.</strong> {req.error}
            </p>
            <button className="btn ghost sm" onClick={go}>
              Try again
            </button>
          </div>
        )}
        {req.status === 'done' && (
          <div className="decision">
            <p className="decision-head">
              {req.data.snapshot.trigger.kind ? (
                <>
                  <strong>A limit check fired.</strong> {req.data.snapshot.trigger.reasons.join(' · ')}
                </>
              ) : (
                <>
                  <strong>No limit was threatened.</strong> Guardian would hold.
                </>
              )}
            </p>
            {req.data.chosen && <span className={`route route-${req.data.approval}`}>{approvalLabel(req.data.approval)}</span>}
            <dl className="plan-values wide">
              <div>
                <dt>Volatility now</dt>
                <dd className="num">{pct(req.data.snapshot.portfolio.annual_vol, 1, false)} a year</dd>
              </div>
              <div>
                <dt>Worst likely day (99%)</dt>
                <dd className="num">{pct(req.data.snapshot.portfolio.daily_var_99, 2, false)}</dd>
              </div>
              <div>
                <dt>Shock type</dt>
                <dd>{req.data.snapshot.shock.label === 'none' ? 'None detected' : req.data.snapshot.shock.label.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())}</dd>
              </div>
            </dl>
            <h4 className="why-head">What moved</h4>
            <AttributionBar a={req.data.snapshot.attribution} />
            {req.data.plans.map((p, i) => (
              <PlanDetails key={i} plan={p} chosen={p.source === req.data.chosen} />
            ))}
            {req.data.approval_reasons.length > 0 && (
              <>
                <h4 className="why-head">Why {req.data.approval === 'ask' ? 'it would ask you first' : 'it would go ahead'}</h4>
                <ul className="why">
                  {req.data.approval_reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
            {req.data.agent && <p className="agent-note">{req.data.agent}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
