import type { Autonomy, Snapshot } from '../engine/types'
import type { EngineMode, PortfolioIn } from './types'

const MODE: Record<Autonomy, EngineMode> = { auto: 'automatic', ask: 'ask_first', paused: 'paused' }

/** The user's rules as the engine expects them. Holdings stay on the engine's demo book for now. */
export function rulesFor(s: Snapshot): PortfolioIn {
  return { max_drawdown: s.guardrails.maxDrawdown, max_daily_loss: s.guardrails.dailyLoss, mode: MODE[s.autonomy] }
}

/** Names the engine uses, in the words the interface uses. */
export const STRATEGY_LABEL = { guardian: 'Guardian', hold: 'Buy and hold', cash_exit: 'Sell everything' } as const

export const ACTION_LABEL: Record<string, string> = { TRIM: 'Trim', ADD: 'Add', SELL: 'Sell', BUY: 'Buy' }

export function approvalLabel(a: string | undefined | null) {
  if (a === 'auto') return 'Placed automatically'
  if (a === 'ask') return 'Needs your approval'
  if (a === 'none') return 'No trade'
  return a ?? ''
}
