import type { ActivityItem } from '../engine/types'

export type Decision = 'sell' | 'ask' | 'hold'

/** What the agent decided, in one of three plain outcomes: it sold, it is asking you, or it held. */
export function decisionOf(a: ActivityItem): Decision {
  if (a.pending) return 'ask'
  return /^(No action|Declined)/.test(a.title) ? 'hold' : 'sell'
}

export const soldAmount = (a: ActivityItem) => (a.trades ?? []).filter((t) => t.side === 'Sell').reduce((s, t) => s + t.amount, 0)

export const DECISION_LABEL: Record<Decision, string> = { sell: 'Sold', ask: 'Asking you', hold: 'Held' }

/** Market risk (beta) before and after the trade, read from the agent's own explanation. */
export function riskChange(a: ActivityItem): [number, number] | null {
  for (const w of a.why) {
    const m = /beta drop(?:s|ped) from ([\d.]+) to ([\d.]+)/.exec(w)
    if (m) return [parseFloat(m[1]), parseFloat(m[2])]
  }
  return null
}
