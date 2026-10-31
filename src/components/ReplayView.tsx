import { ChevronDown, History, Play, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { engine } from '../api/client'
import { approvalLabel, rulesFor, STRATEGY_LABEL } from '../api/portfolio'
import { useSettings } from '../api/settings'
import type { ReplayEvent, ReplayOut, Strategy } from '../api/types'
import { useConnection, useRequest } from '../api/useEngine'
import saved from '../fixtures/replay_2025q1.json'
import { money, pct } from '../engine/format'
import type { Snapshot } from '../engine/types'
import { useUI } from '../store'
import { AgentCard, useElapsed } from './AgentCard'
import { AttributionBar, PlanDetails } from './PlanDetails'
import { SeriesChart, type Series } from './SeriesChart'

const SAVED = saved as unknown as ReplayOut

const PERIODS = [
  { id: 'q1-2025', label: 'Early 2025 tech sell-off', start: '2025-01-02', end: '2025-03-14' },
  { id: 'last-3m', label: 'Last 3 months', start: '2026-08-03', end: '2026-10-30' },
  { id: 'last-6m', label: 'Last 6 months', start: '2026-05-01', end: '2026-10-30' },
]

const ORDER: Strategy[] = ['guardian', 'hold', 'cash_exit']
const CLASS: Record<Strategy, string> = { guardian: 's-guardian', hold: 's-hold', cash_exit: 's-cash' }
const KIND: Record<string, string> = { trigger: 'Limit check', fill: 'Trades filled', exit: 'Sold everything', emergency: 'Emergency de-risk', 're-risk': 'Added risk back' }

const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function Outcome({ r }: { r: ReplayOut }) {
  const g = r.summary.guardian
  const h = r.summary.hold
  const kept = g.max_drawdown <= r.limits.max_drawdown && (g.days_over_daily_limit ?? 0) === 0
  return (
    <p className="outcome">
      {kept ? 'Guardian kept you inside both limits.' : 'Guardian did not keep you inside both limits on this period.'} Its worst fall from a peak was{' '}
      <strong>{pct(g.max_drawdown, 1, false)}</strong> against your {pct(r.limits.max_drawdown, 0, false)} limit (buy and hold: {pct(h.max_drawdown, 1, false)}), with{' '}
      <strong>{g.days_over_daily_limit ?? 0}</strong> {g.days_over_daily_limit === 1 ? 'day' : 'days'} over your {pct(r.limits.max_daily_loss, 0, false)} daily limit
      (buy and hold: {h.days_over_daily_limit ?? 0}).
    </p>
  )
}

function Compare({ r }: { r: ReplayOut }) {
  const rows: { label: string; get: (s: ReplayOut['summary'][Strategy]) => string; better?: 'low' | 'high'; key: keyof ReplayOut['summary'][Strategy] }[] = [
    { label: 'Return', key: 'total_return', get: (s) => pct(s.total_return, 1), better: 'high' },
    { label: 'Worst fall from a peak', key: 'max_drawdown', get: (s) => pct(-s.max_drawdown, 1), better: 'low' },
    { label: 'Worst day', key: 'worst_day', get: (s) => pct(s.worst_day, 1), better: 'high' },
    { label: 'Days over daily limit', key: 'days_over_daily_limit', get: (s) => String(s.days_over_daily_limit ?? 0), better: 'low' },
    { label: 'Trades', key: 'trades', get: (s) => String(s.trades) },
    { label: 'Trading costs', key: 'costs', get: (s) => money(s.costs, true) },
  ]
  return (
    <div className="table-wrap">
      <table className="table compare">
        <thead>
          <tr>
            <th scope="col">Over the period</th>
            {ORDER.map((k) => (
              <th key={k} scope="col" className={`num ${k === 'guardian' ? 'focus' : ''}`}>
                <i className={`tip-key ${CLASS[k]}`} aria-hidden /> {STRATEGY_LABEL[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const vals = ORDER.map((k) => Number(r.summary[k][row.key] ?? 0))
            const best = row.better === 'high' ? Math.max(...vals) : row.better === 'low' ? Math.min(...vals) : null
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {ORDER.map((k, i) => (
                  <td key={k} className={`num ${k === 'guardian' ? 'focus' : ''} ${best !== null && vals[i] === best ? 'best' : ''}`}>
                    {row.get(r.summary[k])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EventRow({ e, id, open, active, onToggle, onHover }: { e: ReplayEvent; id: string; open: boolean; active: boolean; onToggle: () => void; onHover: (on: boolean) => void }) {
  const detail = !!(e.plans?.length || e.attribution)
  const acted = e.kind === 'trigger' && !!e.chosen
  return (
    <li className={`item ev-${e.kind} ${open ? 'open' : ''} ${active ? 'hover' : ''}`} id={id} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <time className="item-time" dateTime={e.date}>
        {new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </time>
      <span className={`glyph ${acted || e.kind === 'emergency' ? 'action' : e.kind === 'fill' || e.kind === 're-risk' ? 'rule' : 'market'}`} aria-hidden>
        <svg viewBox="0 0 12 12" width="12" height="12">
          {acted || e.kind === 'emergency' ? <rect x="2.5" y="2.5" width="7" height="7" rx="1" transform="rotate(45 6 6)" fill="currentColor" /> : <circle cx="6" cy="6" r="3" fill="currentColor" />}
        </svg>
      </span>
      <div className="item-body">
        {detail ? (
          <button className="item-title" aria-expanded={open} onClick={onToggle}>
            <span>
              {KIND[e.kind] ?? e.kind}
              {e.kind === 'trigger' && (e.chosen ? `: ${e.chosen === 'agent' ? 'AI agent’s' : 'engine’s'} plan` : ': no trade')}
            </span>
            <ChevronDown size={15} className="chev" aria-hidden />
          </button>
        ) : (
          <p className="item-title static">{KIND[e.kind] ?? e.kind}</p>
        )}
        <p className="item-summary">{e.reasons?.join(' · ') ?? e.detail}</p>
        {e.approval && e.kind === 'trigger' && e.chosen && <span className={`route route-${e.approval}`}>{approvalLabel(e.approval)}</span>}
        {detail && (
          <div className="reveal" aria-hidden={!open}>
            <div className="reveal-inner">
              {e.attribution && (
                <>
                  <h4 className="why-head">What moved that day</h4>
                  <AttributionBar a={e.attribution} />
                </>
              )}
              {e.plans?.map((p, i) => <PlanDetails key={i} plan={p} chosen={p.source === e.chosen} />)}
              {e.approval_reasons && e.approval_reasons.length > 0 && (
                <>
                  <h4 className="why-head">Why it {e.approval === 'ask' ? 'needed approval' : 'went ahead'}</h4>
                  <ul className="why">
                    {e.approval_reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              {e.agent && <AgentCard a={e.agent} />}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

export function ReplayView({ s }: { s: Snapshot }) {
  const conn = useConnection()
  const settings = useSettings()
  const ui = useUI()
  const [period, setPeriod] = useState(PERIODS[0].id)
  const [req, run, reset] = useRequest(engine.replay)
  const [open, setOpen] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [withAgent, setWithAgent] = useState(false)
  const elapsed = useElapsed(req.status === 'loading')
  const go = () => void run({ ...rulesFor(s), start: p.start, end: p.end }, withAgent && settings.useAgent)

  const live = req.status === 'done' ? req.data : null
  const r = live ?? SAVED
  const online = conn.state === 'online'
  const p = PERIODS.find((x) => x.id === period)!

  const series: Series[] = useMemo(
    () =>
      ORDER.map((k) => ({
        id: k,
        label: STRATEGY_LABEL[k],
        className: CLASS[k],
        points: Object.entries(r.nav[k]).map(([t, v]) => ({ t, v })),
      })),
    [r],
  )
  const start = series[0].points[0]?.v ?? 10_000
  const events = r.events
    .map((e, i) => ({ e, id: `ev-${i}` }))
    .filter(({ e }) => e.strategy === 'guardian' && (all || e.kind !== 'fill'))
  const marks = events.filter(({ e }) => (e.kind === 'trigger' && e.chosen) || e.kind === 'emergency').map(({ e, id }) => ({ t: e.date, id, title: e.reasons?.join('; ') ?? '', tone: e.approval === 'ask' ? ('warn' as const) : ('act' as const) }))

  const rulesDiffer = live === null && (SAVED.limits.max_drawdown !== s.guardrails.maxDrawdown || SAVED.limits.max_daily_loss !== s.guardrails.dailyLoss)

  return (
    <div className="grid replay">
      <section className="panel" aria-labelledby="replay-h">
        <header className="panel-head wrap">
          <h2 id="replay-h">Would Guardian have kept you inside your limits?</h2>
          <span className="source-tag">
            {live ? `Engine replay${r.events.some((e) => e.agent) ? ' with AI agent' : ''}` : 'Saved engine replay'} · {fmtDay(r.start)} to {fmtDay(r.end)} · simulated
          </span>
        </header>

        <div className="controls">
          <label className="select">
            <span className="sr-only">Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!online}>
              {PERIODS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </label>
          <button className="btn solid" disabled={!online || req.status === 'loading'} onClick={go}>
            <Play size={15} aria-hidden />
            {req.status === 'loading' ? `Replaying… ${elapsed}s` : `Replay with your rules`}
          </button>
          {live && (
            <button className="btn ghost" onClick={() => reset({ status: 'idle' })}>
              <RotateCcw size={15} aria-hidden /> Show saved replay
            </button>
          )}
          {online && settings.useAgent && (
            <label className="toggle compact">
              <input type="checkbox" checked={withAgent} onChange={(e) => setWithAgent(e.target.checked)} disabled={req.status === 'loading'} />
              <span className="toggle-ui" aria-hidden />
              Include the AI agent (about a minute per limit check, no live news)
            </label>
          )}
          <p className="controls-note">
            {online
              ? `Uses your ${pct(s.guardrails.maxDrawdown, 0, false)} maximum drop and ${pct(s.guardrails.dailyLoss, 1, false)} daily limit on the engine’s demo portfolio.`
              : (
                  <>
                    Connect the engine to replay other periods with your own rules.{' '}
                    <button className="link" onClick={() => ui.setView('settings')}>
                      Engine settings
                    </button>
                  </>
                )}
          </p>
        </div>

        {req.status === 'error' && (
          <div className="notice error" role="alert">
            <p>
              <strong>The replay didn’t run.</strong> {req.error}
            </p>
            <button className="btn ghost sm" onClick={go}>
              Try again
            </button>
          </div>
        )}
        {rulesDiffer && (
          <p className="notice">
            This saved replay used a {pct(SAVED.limits.max_drawdown, 0, false)} maximum drop and {pct(SAVED.limits.max_daily_loss, 0, false)} daily limit, not your current rules.
          </p>
        )}

        <div className={`replay-body ${req.status === 'loading' ? 'busy' : ''}`} aria-busy={req.status === 'loading'}>
          <Outcome r={r} />
          <SeriesChart
            series={series}
            floor={start * (1 - r.limits.max_drawdown)}
            floorLabel={`Floor ${pct(-r.limits.max_drawdown, 0)}`}
            marks={marks}
            activeMark={active}
            onMark={(id, click) => {
              setActive(id)
              if (click && id) {
                setOpen(id)
                document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
            }}
          />
          <ul className="legend">
            {series.map((x) => (
              <li key={x.id}>
                <i className={`k-series ${x.className}`} /> {x.label}
              </li>
            ))}
            <li>
              <i className="k-limit" /> Floor from your maximum drop
            </li>
            <li>
              <i className="k-marker" /> Guardian traded
            </li>
          </ul>
          <Compare r={r} />
        </div>
      </section>

      <section className="panel activity" aria-labelledby="ev-h">
        <header className="panel-head">
          <h2 id="ev-h">What Guardian did</h2>
          <button className="link" onClick={() => setAll(!all)}>
            {all ? 'Hide fills' : 'Show fills too'}
          </button>
        </header>
        {events.length === 0 ? (
          <p className="empty">
            <History size={16} aria-hidden /> Guardian didn’t need to act in this period: neither limit was threatened.
          </p>
        ) : (
          <ol className="feed">
            {events.map(({ e, id }) => (
              <EventRow
                key={id}
                id={id}
                e={e}
                open={open === id}
                active={active === id}
                onToggle={() => setOpen(open === id ? null : id)}
                onHover={(on) => setActive(on ? id : null)}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
