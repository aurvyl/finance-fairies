import { FlaskConical, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { engine } from '../api/client'
import { approvalLabel, approvalWhy, rulesFor } from '../api/portfolio'
import { useSettings } from '../api/settings'
import { useConnection, useRequest } from '../api/useEngine'
import { pct } from '../engine/format'
import type { Snapshot } from '../engine/types'
import type { Attribution } from '../api/types'
import { useUI } from '../store'
import { AgentCard, useElapsed } from './AgentCard'
import { AttributionBar, PlanDetails } from './PlanDetails'

interface Shock {
  ticker: string
  move: string
}

const PRESETS: { label: string; date?: string; shocks: Shock[] }[] = [
  { label: 'Today, as it happened', date: '2026-10-30', shocks: [] },
  { label: 'NVIDIA falls 15% (29 Oct)', date: '2026-10-29', shocks: [{ ticker: 'NVDA', move: '-15' }] },
  { label: 'NVIDIA falls 12%', shocks: [{ ticker: 'NVDA', move: '-12' }] },
  { label: 'Chip rout', shocks: [{ ticker: 'NVDA', move: '-10' }, { ticker: 'AMD', move: '-9' }, { ticker: 'AVGO', move: '-8' }] },
  { label: 'Big tech slide', shocks: [{ ticker: 'MSFT', move: '-6' }, { ticker: 'GOOGL', move: '-7' }, { ticker: 'META', move: '-8' }, { ticker: 'AMZN', move: '-6' }] },
]

export function WhatIfView({ s }: { s: Snapshot }) {
  const conn = useConnection()
  const settings = useSettings()
  const ui = useUI()
  const [date, setDate] = useState('2026-10-29')
  const [shocks, setShocks] = useState<Shock[]>(PRESETS[1].shocks)
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
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const go = () => void run({ ...rulesFor(s), date, ...(Object.keys(inject).length ? { inject } : {}) })
  const elapsed = useElapsed(req.status === 'loading')
  const agentName = settings.provider === 'gemini' ? 'Gemini' : 'The agent'
  const waiting = settings.useAgent ? `${agentName} is checking the plan… ${elapsed}s` : 'Working it out…'

  return (
    <div className="grid two">
      <section className="panel" aria-labelledby="wi-h">
        <header className="panel-head">
          <h2 id="wi-h">What if the market did this?</h2>
        </header>
        <p className="lede">Pick a day and replace some of that day’s moves. The engine works out what Guardian would do, checks the plan, and says whether it would trade on its own or ask you first.</p>

        <div className="chips presets" role="group" aria-label="Example shocks">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="chip"
              onClick={() => {
                setShocks(p.shocks)
                if (p.date) setDate(p.date)
              }}
            >
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
              {req.status === 'loading' ? waiting : 'See what Guardian would do'}
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
        {req.status === 'loading' && settings.useAgent && (
          <p className="progress-note" role="status">
            {waiting} The engine re-checks every plan the agent proposes; this usually takes 25 to 45 seconds{settings.liveNews ? ', about 75 with live news' : ''}.
          </p>
        )}
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
          <div className="verdict">
            <div className="verdict-top">
              <div className="verdict-tags">
                {/* the engine only trades when a limit check fires, so a passing plan on a calm day is not "placed" */}
                {req.data.chosen && req.data.snapshot.trigger.kind ? (
                  <span className={`route route-${req.data.approval}`}>{approvalLabel(req.data.approval)}</span>
                ) : (
                  <span className="route route-hold">Would hold</span>
                )}
                {req.data.cached && <span className="source-tag cached">Instant: recorded agent answer</span>}
              </div>
              <p className="verdict-head">
                {req.data.snapshot.trigger.kind ? (
                  <>
                    <strong>A limit check fired.</strong>{' '}
                    {req.data.snapshot.trigger.reasons.length === 1 ? 'One of your limits was crossed.' : `${req.data.snapshot.trigger.reasons.length} of your limits were crossed.`}
                  </>
                ) : (
                  <>
                    <strong>No limit was threatened.</strong> Guardian would hold.
                  </>
                )}
              </p>
            </div>
            {req.data.agent && <AgentCard a={req.data.agent} agrees={req.data.agent_agrees_with_engine} />}
            <section className="verdict-block" aria-labelledby="wi-moved">
              <h4 className="why-head" id="wi-moved">
                What moved
              </h4>
              <MoveGauge a={req.data.snapshot.attribution} />
            </section>
            {req.data.snapshot.trigger.kind && req.data.approval_reasons.length > 0 && (
              <section className="verdict-block">
                <h4 className="why-head">{approvalWhy(req.data.approval)}</h4>
                <ul className="why">
                  {req.data.approval_reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            )}
            <details className="exact">
              <summary>See the exact numbers</summary>
              <div className="exact-body">
                {req.data.snapshot.trigger.reasons.length > 0 && (
                  <>
                    <h4 className="why-head">Limit checks</h4>
                    <ul className="why">
                      {req.data.snapshot.trigger.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
                <dl className="plan-values">
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
                <AttributionBar a={req.data.snapshot.attribution} />
                {req.data.plans.map((p, i) => (
                  <PlanDetails key={i} plan={p} chosen={p.source === req.data.chosen} />
                ))}
              </div>
            </details>
          </div>
        )}
      </section>
    </div>
  )
}

/** Where the day's fall came from, as one gauge: the whole market versus the holdings themselves. Exact splits sit in tooltips. */
function MoveGauge({ a }: { a: Attribution }) {
  const total = Math.abs(a.market_part) + Math.abs(a.stock_specific_part) || 1
  const mkt = (Math.abs(a.market_part) / total) * 100
  const top = [...a.holdings]
    .filter((h) => h.contribution !== null)
    .sort((x, y) => Math.abs(y.contribution!) - Math.abs(x.contribution!))
    .slice(0, 3)
  const ownTip = `Your own holdings: ${pct(a.stock_specific_part, 2)}${top.length ? `. Biggest: ${top.map((h) => `${h.ticker} ${pct(h.contribution!, 2)}`).join(', ')}` : ''}`
  const mktTip = `The market as a whole (${a.benchmark}): ${pct(a.market_part, 2)}`
  const lead = mkt >= 50 ? 'Mostly the whole market' : 'Mostly your own holdings'
  return (
    <div className="move-gauge">
      <p className="move-lead">
        <strong>{lead}.</strong> You {a.portfolio_return < 0 ? 'fell' : 'rose'}{' '}
        <strong className={a.portfolio_return < 0 ? 'down' : 'up'}>{pct(Math.abs(a.portfolio_return), 1, false)}</strong>; the market {a.benchmark_return < 0 ? 'fell' : 'rose'}{' '}
        {pct(Math.abs(a.benchmark_return), 1, false)}.
      </p>
      <div className="move-track" role="img" aria-label={`${mktTip}. ${ownTip}`}>
        <span className="move-mkt" style={{ width: `${mkt}%` }} title={mktTip} />
        <span className="move-own" style={{ width: `${100 - mkt}%` }} title={ownTip} />
      </div>
      <div className="move-scale" aria-hidden>
        <span>
          <i className="move-mkt" /> Market {Math.round(mkt)}%
        </span>
        <span>
          Your holdings {100 - Math.round(mkt)}% <i className="move-own" />
        </span>
      </div>
      {top.length > 0 && <p className="move-top">Led by {top.map((h) => h.ticker).join(', ')}</p>}
    </div>
  )
}
