export type AssetClass = 'Stock' | 'Crypto' | 'Fund' | 'Bond' | 'Cash'

export type Sector =
  | 'Technology'
  | 'Semiconductors'
  | 'Financials'
  | 'Healthcare'
  | 'Energy'
  | 'Consumer'
  | 'Industrials'
  | 'Crypto'
  | 'Global equity'
  | 'Bonds'
  | 'Cash'

export interface Holding {
  symbol: string
  name: string
  assetClass: AssetClass
  sector: Sector
  qty: number
  price: number
  open: number
  /** sensitivity to the broad market factor */
  beta: number
  /** annualised idiosyncratic volatility */
  vol: number
  /** price path today, one point per tick, for row sparklines */
  path: number[]
}

export interface Point {
  t: number
  v: number
}

export interface Guardrails {
  /** max drawdown from the high-water mark, as a fraction (0.10 = 10%) */
  maxDrawdown: number
  /** max loss in one trading day from the open, as a fraction */
  dailyLoss: number
  /** fraction of a limit at which the agent starts acting */
  actAt: number
}

export type Autonomy = 'auto' | 'ask' | 'paused'

export interface Trade {
  side: 'Sell' | 'Buy'
  symbol: string
  amount: number
}

export interface ActivityItem {
  id: string
  kind: 'action' | 'market' | 'rule'
  t: number
  title: string
  summary: string
  /** reasons, each a short sentence with the numbers behind it */
  why: string[]
  trades?: Trade[]
  rule?: 'drawdown' | 'daily'
  /** headroom used before and after, 0..1 */
  usedBefore?: number
  usedAfter?: number
  /** portfolio value at the time, for chart markers */
  value: number
  pending?: boolean
}

export interface SectorMove {
  sector: Sector
  pct: number
  contribution: number
}

export interface Snapshot {
  now: number
  dayStart: number
  dayEnd: number
  value: number
  open: number
  highWater: number
  holdings: Holding[]
  intraday: Point[]
  daily: Point[]
  guardrails: Guardrails
  autonomy: Autonomy
  activity: ActivityItem[]
  marketOpen: boolean
  shock: number
}
