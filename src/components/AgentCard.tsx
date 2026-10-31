import { ExternalLink, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentNote } from '../api/types'

const DECISION: Record<string, string> = { ROTATE: 'Rotate to lower-risk holdings', HOLD: 'Hold', HEDGE_REQUEST: 'Asked for a hedge' }
const PROVIDER: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', openrouter: 'OpenRouter' }

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/**
 * The AI agent's side of a decision: what it proposed, why, and how many times the engine
 * checked it. The engine's own plan stays the source of every number.
 */
export function AgentCard({ a, agrees }: { a: AgentNote; agrees?: boolean }) {
  const name = PROVIDER[a.provider] ?? a.provider
  if (a.error)
    return (
      <p className="agent-note">
        {name} couldn’t answer this time ({a.error}). The engine’s own plan was used.
      </p>
    )
  const checks = a.checks_run ?? a.tool_calls?.filter((t) => t === 'check_plan').length ?? 0
  return (
    <div className="agent-card">
      <div className="agent-head">
        <span className="agent-who">
          <Sparkles size={14} aria-hidden /> {name}
          {a.decision && <strong>{DECISION[a.decision] ?? a.decision}</strong>}
        </span>
        {agrees !== undefined && <span className={`agree ${agrees ? 'yes' : 'no'}`}>{agrees ? 'Agrees with the engine' : 'Differs from the engine'}</span>}
      </div>
      {a.explanation && <p className="agent-why">{a.explanation}</p>}
      {a.key_factors && a.key_factors.length > 0 && (
        <ul className="why">
          {a.key_factors.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
      {((a.news_considered?.length ?? 0) > 0 || (a.sources?.length ?? 0) > 0) && (
        <div className="agent-news">
          <h4 className="why-head">News it considered</h4>
          {a.news_considered && a.news_considered.length > 0 && (
            <ul className="why">
              {a.news_considered.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {a.sources && a.sources.length > 0 && (
            <ul className="sources">
              {a.sources.slice(0, 6).map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title || host(s.url)} <ExternalLink size={12} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {a.news_error && <p className="muted small">News wasn’t available: {a.news_error}</p>}
      <p className="trail">
        {name} proposed{checks > 0 ? `, the engine checked it ${checks} ${checks === 1 ? 'time' : 'times'}` : ''}
        {a.tool_calls && a.tool_calls.length > 0 && <span title={a.tool_calls.join(' → ')}> · {a.tool_calls.length} tool calls</span>}
        {a.model && <span> · {a.model}</span>}
      </p>
    </div>
  )
}

/** Elapsed seconds while an agent call runs, so a 30 to 75 second wait reads as progress. */
export function useElapsed(running: boolean) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    setS(0)
    const id = window.setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return s
}
