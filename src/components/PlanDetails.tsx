import { Check, X } from 'lucide-react'
import { ACTION_LABEL } from '../api/portfolio'
import type { Attribution, PlanOut } from '../api/types'
import { pct } from '../engine/format'

const VALUE_LABEL: Record<string, string> = {
  vol_before: 'Volatility before',
  vol_after: 'Volatility after',
  daily_var_before: 'Worst likely day before',
  daily_var_after: 'Worst likely day after',
  turnover: 'Share of portfolio traded',
  cost_nav: 'Trading cost',
}

/** One checked plan: what it would trade, whether it passed the engine's checks, and why not. */
export function PlanDetails({ plan, chosen }: { plan: PlanOut; chosen: boolean }) {
  const v = plan.values
  return (
    <div className={`plan ${plan.passed ? 'pass' : 'fail'} ${chosen ? 'chosen' : ''}`}>
      <div className="plan-head">
        <span className="plan-src">{plan.source === 'agent' ? 'AI agent’s plan' : 'Engine’s plan'}</span>
        <span className={`plan-verdict ${plan.passed ? 'up' : 'down'}`}>
          {plan.passed ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
          {plan.passed ? (chosen ? 'Passed, chosen' : 'Passed checks') : 'Rejected'}
        </span>
      </div>
      {plan.actions.length > 0 && (
        <ul className="actions">
          {plan.actions.map((a, i) => (
            <li key={i} className={`act-${a.type.toLowerCase()}`}>
              <span>{ACTION_LABEL[a.type] ?? a.type}</span>
              <strong>{a.ticker}</strong>
              <span className="num">{pct(a.weight, 0, false)}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.rejections.length > 0 && (
        <ul className="rejections">
          {plan.rejections.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <dl className="plan-values">
        {Object.entries(VALUE_LABEL).map(([k, label]) =>
          typeof v[k] === 'number' ? (
            <div key={k}>
              <dt>{label}</dt>
              <dd className="num">{pct(v[k] as number, k === 'cost_nav' ? 2 : 1, false)}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  )
}

/** Market versus stock-specific split of one day, as a single proportional bar. */
export function AttributionBar({ a }: { a: Attribution }) {
  const total = Math.abs(a.market_part) + Math.abs(a.stock_specific_part) || 1
  const top = [...a.holdings].filter((h) => h.contribution !== null).sort((x, y) => Math.abs(y.contribution!) - Math.abs(x.contribution!)).slice(0, 3)
  return (
    <div className="attr">
      <p className="attr-line">
        Portfolio <strong className={a.portfolio_return < 0 ? 'down' : 'up'}>{pct(a.portfolio_return, 2)}</strong> vs {a.benchmark}{' '}
        <strong className={a.benchmark_return < 0 ? 'down' : 'up'}>{pct(a.benchmark_return, 2)}</strong>. {pct(a.market_share, 0, false)} of the move came from
        the market as a whole.
      </p>
      <div className="attr-bar" role="img" aria-label={`Market ${pct(a.market_part, 2)}, stock-specific ${pct(a.stock_specific_part, 2)}`}>
        <span className="attr-mkt" style={{ flexGrow: Math.abs(a.market_part) / total }} />
        <span className="attr-own" style={{ flexGrow: Math.abs(a.stock_specific_part) / total }} />
      </div>
      <div className="attr-key">
        <span>
          <i className="attr-mkt" /> Market {pct(a.market_part, 2)}
        </span>
        <span>
          <i className="attr-own" /> Stock-specific {pct(a.stock_specific_part, 2)}
        </span>
      </div>
      {top.length > 0 && (
        <p className="attr-top">
          Biggest contributors: {top.map((h) => `${h.ticker} ${pct(h.contribution!, 2)}`).join(', ')}
        </p>
      )}
    </div>
  )
}
