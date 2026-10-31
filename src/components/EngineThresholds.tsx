import { useEffect } from 'react'
import { engine } from '../api/client'
import { rulesFor } from '../api/portfolio'
import { useConnection, useRequest } from '../api/useEngine'
import { pct } from '../engine/format'
import type { Snapshot } from '../engine/types'
import { useUI } from '../store'

/** The engine's own lines for the user's two rules, so they can see exactly when it acts. */
export function EngineThresholds({ s }: { s: Snapshot }) {
  const conn = useConnection()
  const ui = useUI()
  const [req, run] = useRequest(engine.limits)
  const online = conn.state === 'online'
  const dd = s.guardrails.maxDrawdown
  const dl = s.guardrails.dailyLoss

  useEffect(() => {
    if (!online) return
    const id = window.setTimeout(() => void run({ max_drawdown: dd, max_daily_loss: dl, mode: rulesFor(s).mode }), 250)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, dd, dl, run])

  return (
    <section className="panel" aria-labelledby="thr-h">
      <header className="panel-head">
        <h2 id="thr-h">When the engine steps in</h2>
      </header>
      {!online ? (
        <p className="empty">
          Connect the Guardian engine to see the exact lines it derives from your rules.{' '}
          <button className="link" onClick={() => ui.setView('settings')}>
            Engine settings
          </button>
        </p>
      ) : req.status === 'error' ? (
        <p className="notice error" role="alert">
          {req.error}
        </p>
      ) : req.status !== 'done' ? (
        <div className="skeleton block" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <dl className="thresholds">
          <div>
            <dt>Rotate to lower-risk holdings</dt>
            <dd>down {pct(req.data.thresholds.rotation_loss, 1, false)} from your starting value or peak</dd>
          </div>
          <div>
            <dt>Emergency de-risk</dt>
            <dd>down {pct(req.data.thresholds.emergency_loss, 1, false)}</dd>
          </div>
          <div>
            <dt>Shock day</dt>
            <dd>a single day of {pct(req.data.thresholds.shock_day, 1)} or worse</dd>
          </div>
          <div>
            <dt>Daily risk budget</dt>
            <dd>99% worst likely day kept under {pct(req.data.thresholds.daily_var_limit, 1, false)}</dd>
          </div>
          <div>
            <dt>Add risk back</dt>
            <dd>once the loss recovers to {pct(req.data.thresholds.rerisk_loss, 1, false)}</dd>
          </div>
          {req.data.thresholds.auto_max_trade_weight !== undefined && (
            <div>
              <dt>Trades it places without asking</dt>
              <dd>up to {pct(req.data.thresholds.auto_max_trade_weight, 0, false)} of the portfolio each</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}
