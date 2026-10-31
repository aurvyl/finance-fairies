/** Shapes returned by the Guardian engine (engine/guardian/api.py). The engine computes every number. */

export type EngineMode = 'automatic' | 'ask_first' | 'paused'
export type Strategy = 'hold' | 'cash_exit' | 'guardian'

export interface Thresholds {
  rotation_loss: number
  hwm_drawdown?: number
  emergency_loss: number
  shock_day: number
  daily_var_limit: number
  rerisk_loss: number
  auto_max_trade_weight?: number
}

export interface Health {
  ok: boolean
  simulated: boolean
  datasets: Record<string, [string, string]>
}

export interface Provider {
  id: string
  label: string
  default_model: string
  features: string[]
  key_configured: boolean
  recommended: boolean
}

export interface LimitsOut {
  limits: { max_drawdown: number; max_daily_loss: number }
  thresholds: Thresholds
  holdings: Record<string, number>
  asset_class: Record<string, string>
}

export interface Action {
  type: 'TRIM' | 'ADD' | 'SELL' | 'BUY' | string
  ticker: string
  weight: number
}

export interface PlanOut {
  source: 'engine' | 'agent' | string
  passed: boolean
  rejections: string[]
  values: Record<string, number | null>
  actions: Action[]
}

export interface HoldingAttribution {
  ticker: string
  weight: number
  beta: number | null
  return: number | null
  market_part: number | null
  stock_specific: number | null
  contribution: number | null
  z_score: number | null
  unusual: boolean
}

export interface Attribution {
  portfolio_return: number
  benchmark: string
  benchmark_return: number
  portfolio_beta: number
  market_part: number
  stock_specific_part: number
  market_share: number
  main_driver: string
  unusual_moves: string[] | { ticker: string }[]
  holdings: HoldingAttribution[]
}

export interface ReplayEvent {
  date: string
  strategy: Strategy
  kind: 'trigger' | 'fill' | 'exit' | 'emergency' | 're-risk' | string
  reasons?: string[]
  detail?: string
  values?: Record<string, number | null>
  shock?: { label: string; suggested_path: string; main_loss_driver?: string } & Record<string, unknown>
  plans?: PlanOut[]
  chosen?: string | null
  agent?: AgentNote | null
  attribution?: Attribution
  approval?: 'auto' | 'ask' | 'none' | string
  approval_reasons?: string[]
}

export interface StrategySummary {
  final_value: number
  total_return: number
  max_drawdown: number
  worst_day: number
  trades: number
  costs: number
  max_loss_vs_baseline?: number
  days_over_daily_limit?: number
}

export interface ReplayOut {
  start: string
  end: string
  simulated: boolean
  limits: { max_drawdown: number; max_daily_loss: number }
  thresholds: Thresholds
  nav: Record<Strategy, Record<string, number>>
  summary: Record<Strategy, StrategySummary>
  events: ReplayEvent[]
}

export interface AnalyzeOut {
  snapshot: {
    date: string
    trigger: { kind: string | null; reasons: string[]; values: Record<string, number | null>; budget_breach?: boolean }
    shock: { label: string; suggested_path: string } & Record<string, unknown>
    attribution: Attribution
    portfolio: { weights: Record<string, number>; annual_vol: number; daily_var_99: number }
    injected_shock: Record<string, number>
  }
  plans: PlanOut[]
  chosen: string | null
  approval: string
  approval_reasons: string[]
  agent: AgentNote | null
  agent_agrees_with_engine?: boolean
  cached?: boolean
  simulated: boolean
}

/** What the AI agent proposed and how the engine checked it. Every number still comes from the engine. */
export interface AgentNote {
  provider: string
  model: string
  error: string | null
  decision?: 'ROTATE' | 'HOLD' | 'HEDGE_REQUEST' | string
  explanation?: string
  key_factors?: string[]
  news_considered?: string[]
  sources?: { url: string; title: string | null }[]
  tool_calls?: string[]
  checks_run?: number
  news_brief?: string | null
  news_error?: string | null
}

export interface PortfolioIn {
  max_drawdown: number
  max_daily_loss: number
  baseline?: number
  mode?: EngineMode
  holdings?: Record<string, number>
  candidates?: string[]
}

export interface AgentConfig {
  provider: string
  model?: string
  live?: boolean
  thinking_level?: 'minimal' | 'low' | 'medium' | 'high'
  code_execution?: boolean
}
