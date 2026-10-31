import { buildPortfolio, gauss, rng, SECTORS } from './data'
import { compactMoney, money, pct } from './format'
import type { ActivityItem, Autonomy, Guardrails, Holding, Point, Sector, SectorMove, Snapshot, Trade } from './types'

/**
 * A self-contained market + agent simulation. Everything here is synthetic demo data:
 * prices follow a one-factor model with sector factors, and the agent applies the
 * user's portfolio-level guardrails to it. Swap this module for a real broker feed and
 * decision service; the UI only reads Snapshot and calls the public methods.
 */

const TICK_MS = 900
const SIM_MIN_PER_TICK = 2
const MIN = 60_000
const DT = SIM_MIN_PER_TICK / (390 * 252) // year fraction per tick
const LEVELS = [0.6, 0.85, 1] // share of a limit at which the agent acts, escalating
const SELL_SHARE = [0.18, 0.35, 0.7]

type Listener = () => void

let idSeq = 0
const nid = () => `a${++idSeq}`

function marketDay(base = new Date()) {
  const d = new Date(base)
  d.setHours(9, 30, 0, 0)
  return d.getTime()
}

export class Simulation {
  private listeners = new Set<Listener>()
  private r = rng(7)
  private holdings: Holding[]
  private now: number
  private dayStart: number
  private open: number
  private highWater: number
  private intraday: Point[] = []
  private daily: Point[] = []
  private activity: ActivityItem[] = []
  private guardrails: Guardrails = { maxDrawdown: 0.1, dailyLoss: 0.02, actAt: LEVELS[0] }
  private autonomy: Autonomy = 'auto'
  private dailyLevel = -1
  private ddLevel = -1
  private shock = 0
  private baseDrift = 0.00004
  private windowPrices = new Map<string, number>()
  private windowStart = 0
  private sectorDrift: Partial<Record<Sector, number>> = {}
  private timer: number | undefined
  private snap!: Snapshot

  constructor() {
    this.dayStart = marketDay()
    this.now = this.dayStart
    this.holdings = buildPortfolio(2_480_000)
    this.open = this.value()
    this.daily = this.backfillDaily(this.open)
    this.highWater = Math.max(...this.daily.map((p) => p.v))
    this.intraday = [{ t: this.now, v: this.open }]
    this.seedHistory()
    this.markWindow()
    // play the morning forward quietly so the page opens mid-session
    const r0 = this.r
    this.r = rng(42)
    this.sectorDrift = { Semiconductors: -0.0002, Crypto: -0.0003 }
    this.baseDrift = -0.00006
    for (let i = 0; i < 68; i++) this.step(true)
    this.sectorDrift = {}
    this.baseDrift = 0.00004
    this.r = r0
    this.emit()
  }

  // ---------- public API ----------

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.snap

  start() {
    if (this.timer) return
    this.timer = window.setInterval(() => this.step(false), TICK_MS)
  }

  stop() {
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  /** Demo control: a sharp, semis-and-crypto-led sell-off over the next ~20 sim minutes. */
  triggerShock() {
    this.shock = 14
    this.sectorDrift = { Semiconductors: -0.0012, Crypto: -0.0018, Technology: -0.0004 }
    this.push({
      id: nid(),
      kind: 'market',
      t: this.now,
      title: 'Sell-off starting in chips and crypto',
      summary: 'Semiconductors and crypto are falling fast. I’m watching your daily limit closely.',
      why: [
        'Semiconductor names in your book are falling about three times faster than the broad market.',
        'Crypto is moving with them, which removes the diversification you usually get from it.',
        `Together those two groups are ${pct(this.shareOf(['Semiconductors', 'Crypto']), 0, false)} of the portfolio.`,
      ],
      value: this.value(),
    })
    this.emit()
  }

  setGuardrails(next: Partial<Guardrails>) {
    const prev = this.guardrails
    this.guardrails = { ...prev, ...next }
    const parts: string[] = []
    if (next.dailyLoss !== undefined && next.dailyLoss !== prev.dailyLoss)
      parts.push(`daily loss limit from ${pct(prev.dailyLoss, 1, false)} to ${pct(next.dailyLoss, 1, false)}`)
    if (next.maxDrawdown !== undefined && next.maxDrawdown !== prev.maxDrawdown)
      parts.push(`maximum drop from ${pct(prev.maxDrawdown, 0, false)} to ${pct(next.maxDrawdown, 0, false)}`)
    if (parts.length) {
      // re-arm the escalation ladder against the new limits
      this.dailyLevel = this.levelFor(this.dailyUsed()) - 1
      this.ddLevel = this.levelFor(this.ddUsed()) - 1
      this.push({
        id: nid(),
        kind: 'rule',
        t: this.now,
        title: 'Guardrail updated',
        summary: `You changed the ${parts.join(' and ')}.`,
        why: [
          `Headroom now: ${pct(1 - this.dailyUsed(), 0, false)} of today’s loss budget and ${pct(1 - this.ddUsed(), 0, false)} of your drawdown budget remain.`,
          `I start reducing risk when either reaches ${pct(this.guardrails.actAt, 0, false)} of its limit.`,
        ],
        value: this.value(),
      })
    }
    this.emit()
  }

  setAutonomy(a: Autonomy) {
    if (a === this.autonomy) return
    const label = { auto: 'act automatically', ask: 'ask before acting', paused: 'stay paused' }[a]
    this.autonomy = a
    this.push({
      id: nid(),
      kind: 'rule',
      t: this.now,
      title: a === 'paused' ? 'Agent paused' : 'Agent mode changed',
      summary: `I’ll ${label} from now on.`,
      why:
        a === 'paused'
          ? ['I will keep watching and explaining, but I won’t trade, even if a limit is breached.']
          : a === 'ask'
            ? ['When a limit gets close I’ll propose trades here and wait for your approval.']
            : ['When a limit gets close I’ll reduce risk on my own and tell you why.'],
      value: this.value(),
    })
    this.emit()
  }

  approve(id: string) {
    const item = this.activity.find((a) => a.id === id)
    if (!item?.pending || !item.trades) return
    // The proposal was sized at the prices of the moment it was made, and other proposals may have
    // been approved since: never sell more than is held now, and buy only what the sells raise.
    const sells = item.trades
      .filter((t) => t.side === 'Sell')
      .map((t) => {
        const h = this.holdings.find((x) => x.symbol === t.symbol)
        return { ...t, amount: Math.min(t.amount, h ? Math.max(0, h.qty * h.price) : 0) }
      })
      .filter((t) => t.amount > 0)
    const raised = sells.reduce((a, t) => a + t.amount, 0)
    const buys = item.trades.filter((t) => t.side === 'Buy')
    const planned = buys.reduce((a, t) => a + t.amount, 0)
    const trades = [...sells, ...buys.map((t) => ({ ...t, amount: planned > 0 ? (t.amount / planned) * raised : 0 }))]
    this.execute(trades)
    this.activity = this.activity.map((a) =>
      a.id === id ? { ...a, pending: false, title: a.title.replace('Proposed: ', ''), usedAfter: item.rule === 'daily' ? this.dailyUsed() : this.ddUsed() } : a,
    )
    this.emit()
  }

  dismiss(id: string) {
    this.activity = this.activity.map((a) =>
      a.id === id ? { ...a, pending: false, title: 'Declined: ' + a.title.replace('Proposed: ', ''), trades: [] } : a,
    )
    this.emit()
  }

  // ---------- derived numbers (also used by the explainer) ----------

  value(list = this.holdings) {
    let v = 0
    for (const h of list) v += h.qty * h.price
    return v
  }

  dailyUsed() {
    const change = this.value() / this.open - 1
    return Math.max(0, -change) / this.guardrails.dailyLoss
  }

  ddUsed() {
    const dd = 1 - this.value() / this.highWater
    return Math.max(0, dd) / this.guardrails.maxDrawdown
  }

  sectorMoves(since: Map<string, number> | 'open'): SectorMove[] {
    const by = new Map<Sector, { from: number; to: number }>()
    for (const h of this.holdings) {
      const p0 = since === 'open' ? h.open : (since.get(h.symbol) ?? h.open)
      const e = by.get(h.sector) ?? { from: 0, to: 0 }
      e.from += h.qty * p0
      e.to += h.qty * h.price
      by.set(h.sector, e)
    }
    const total = [...by.values()].reduce((a, e) => a + e.from, 0)
    return SECTORS.filter((s) => by.has(s))
      .map((s) => {
        const e = by.get(s)!
        return { sector: s, pct: e.from ? e.to / e.from - 1 : 0, contribution: (e.to - e.from) / total }
      })
      .sort((a, b) => a.contribution - b.contribution)
  }

  // ---------- internals ----------

  private emit() {
    this.snap = {
      now: this.now,
      dayStart: this.dayStart,
      dayEnd: this.dayStart + 390 * MIN,
      value: this.value(),
      open: this.open,
      highWater: this.highWater,
      holdings: this.holdings.map((h) => ({ ...h })),
      intraday: this.intraday,
      daily: this.daily,
      guardrails: this.guardrails,
      autonomy: this.autonomy,
      activity: this.activity,
      marketOpen: this.now < this.dayStart + 390 * MIN,
      shock: this.shock,
    }
    for (const l of this.listeners) l()
  }

  private push(item: ActivityItem) {
    this.activity = [item, ...this.activity].slice(0, 80)
  }

  private shareOf(sectors: Sector[]) {
    const v = this.value()
    return this.holdings.filter((h) => sectors.includes(h.sector)).reduce((a, h) => a + h.qty * h.price, 0) / v
  }

  private levelFor(used: number) {
    let l = 0
    while (l < LEVELS.length && used >= LEVELS[l]) l++
    return l // number of thresholds crossed
  }

  private step(quiet: boolean) {
    if (this.now >= this.dayStart + 390 * MIN) {
      this.rollDay()
      if (!quiet) this.emit()
      return
    }
    this.now += SIM_MIN_PER_TICK * MIN
    const sq = Math.sqrt(DT)
    const shockDrift = this.shock > 0 ? -0.0005 : 0
    if (this.shock > 0) {
      this.shock--
      if (this.shock === 0) this.sectorDrift = { Semiconductors: 0.0006, Crypto: 0.0008 }
    }
    const mkt = this.baseDrift + shockDrift + 0.15 * sq * gauss(this.r)
    const sectorF: Partial<Record<Sector, number>> = {}
    for (const s of SECTORS) sectorF[s] = (this.sectorDrift[s] ?? 0) + 0.1 * sq * gauss(this.r)
    for (const h of this.holdings) {
      if (h.assetClass === 'Cash') {
        h.price *= 1 + 0.045 * DT
      } else {
        const ret = h.beta * mkt + (sectorF[h.sector] ?? 0) * (h.sector === 'Global equity' ? 0.3 : 1) + h.vol * sq * gauss(this.r) * 0.6
        h.price = Math.max(h.price * (1 + ret), 0.0001)
      }
      h.path = [...h.path, h.price]
    }
    const v = this.value()
    this.intraday = [...this.intraday, { t: this.now, v }]
    this.highWater = Math.max(this.highWater, v)

    this.marketNote()
    this.guard()
    if (!quiet) this.emit()
  }

  private rollDay() {
    const close = this.value()
    this.daily = [...this.daily, { t: this.dayStart, v: close }]
    const next = new Date(this.dayStart)
    next.setDate(next.getDate() + 1)
    this.dayStart = next.getTime()
    this.now = this.dayStart
    this.open = close
    this.dailyLevel = -1
    for (const h of this.holdings) {
      h.open = h.price
      h.path = [h.price]
    }
    this.intraday = [{ t: this.now, v: close }]
    this.markWindow()
    this.push({
      id: nid(),
      kind: 'rule',
      t: this.now,
      title: 'New trading day',
      summary: `Your daily loss budget has reset to ${pct(this.guardrails.dailyLoss, 1, false)}.`,
      why: [`Yesterday closed at ${money(close)}.`],
      value: close,
    })
  }

  private markWindow() {
    this.windowStart = this.now
    this.windowPrices = new Map(this.holdings.map((h) => [h.symbol, h.price]))
  }

  /** Every 30 sim minutes, explain the move if it was meaningful. */
  private marketNote() {
    if (this.now - this.windowStart < 30 * MIN) return
    const moves = this.sectorMoves(this.windowPrices)
    const start = [...this.windowPrices].reduce((a, [sym, p]) => a + p * (this.holdings.find((h) => h.symbol === sym)?.qty ?? 0), 0)
    const change = this.value() / start - 1
    this.markWindow()
    if (Math.abs(change) < 0.004) return
    const down = change < 0
    const sorted = down ? moves : [...moves].reverse()
    const lead = sorted.slice(0, 2)
    const total = moves.reduce((a, m) => a + m.contribution, 0)
    const share = lead.reduce((a, m) => a + m.contribution, 0) / (total || 1)
    this.push({
      id: nid(),
      kind: 'market',
      t: this.now,
      title: `${down ? 'Down' : 'Up'} ${pct(Math.abs(change), 2, false)} in the last 30 minutes`,
      summary: `${lead.map((m) => m.sector).join(' and ')} drove ${pct(Math.min(1, Math.max(0, share)), 0, false)} of the move.`,
      why: [
        ...lead.map((m) => `${m.sector} moved ${pct(m.pct)} and changed the portfolio by ${pct(m.contribution)}.`),
        down
          ? 'High-beta holdings fell more than the market, as they usually do on risk-off days.'
          : 'High-beta holdings led the rebound.',
      ],
      value: this.value(),
    })
  }

  /** The agent: escalate through LEVELS on whichever rule is closest to its limit. */
  private guard() {
    const daily = this.dailyUsed()
    const dd = this.ddUsed()
    if (dd < 0.4) this.ddLevel = -1
    const dl = this.levelFor(daily) - 1
    const ddl = this.levelFor(dd) - 1
    let rule: 'daily' | 'drawdown' | null = null
    let level = -1
    if (dl > this.dailyLevel) {
      rule = 'daily'
      level = dl
    }
    if (ddl > this.ddLevel && ddl >= level) {
      rule = 'drawdown'
      level = ddl
    }
    if (!rule) return
    if (rule === 'daily') this.dailyLevel = level
    else this.ddLevel = level

    const used = rule === 'daily' ? daily : dd
    const limit = rule === 'daily' ? this.guardrails.dailyLoss : this.guardrails.maxDrawdown
    const ruleName = rule === 'daily' ? 'daily loss limit' : 'maximum drop'
    const trades = this.planTrades(SELL_SHARE[level])
    const betaBefore = this.beta()
    const moves = this.sectorMoves(rule === 'daily' ? 'open' : this.windowPrices).slice(0, 2)

    if (this.autonomy === 'paused') {
      this.push({
        id: nid(),
        kind: 'action',
        t: this.now,
        rule,
        title: `No action: ${ruleName} at ${pct(used, 0, false)}`,
        summary: 'You paused me, so I haven’t traded. Resume to let me protect the limit.',
        why: [`You’ve used ${pct(used, 0, false)} of your ${pct(limit, rule === 'daily' ? 1 : 0, false)} ${ruleName}.`],
        usedBefore: used,
        value: this.value(),
      })
      return
    }

    const after = this.simulate(trades)
    const betaAfter = this.beta(after)
    const sells = trades.filter((t) => t.side === 'Sell')
    const sold = sells.reduce((a, t) => a + t.amount, 0)
    const names = sells.slice(0, 3).map((t) => t.symbol)
    const verb = ['Trimmed', 'Cut', 'Moved most risk out of'][level]
    const why = [
      `You’ve used ${pct(used, 0, false)} of your ${pct(limit, rule === 'daily' ? 1 : 0, false)} ${ruleName}. I act at ${pct(LEVELS[level], 0, false)}.`,
      `${moves.map((m) => `${m.sector} (${pct(m.pct)})`).join(' and ')} caused most of the fall.`,
      `I sold ${compactMoney(sold)} across ${sells.length} positions that add the most risk per dollar, and parked it in 0–3 month Treasuries.`,
      `Portfolio beta drops from ${betaBefore.toFixed(2)} to ${betaAfter.toFixed(2)}: another 1% market fall would now cost about ${pct(betaAfter / 100, 2, false)} instead of ${pct(betaBefore / 100, 2, false)}.`,
    ]
    if (level === 2) why.push('You’re at the limit, so I’ll hold off adding risk until tomorrow’s open unless you tell me otherwise.')

    const item: ActivityItem = {
      id: nid(),
      kind: 'action',
      t: this.now,
      rule,
      title: `${this.autonomy === 'ask' ? 'Proposed: ' : ''}${verb} ${names.join(', ')}${sells.length > 3 ? ` +${sells.length - 3}` : ''}`,
      summary: `${ruleName[0].toUpperCase() + ruleName.slice(1)} at ${pct(used, 0, false)} of limit. ${this.autonomy === 'ask' ? 'Waiting for your OK.' : `Moved ${compactMoney(sold)} to Treasuries.`}`,
      why,
      trades,
      usedBefore: used,
      value: this.value(),
      pending: this.autonomy === 'ask',
    }
    if (this.autonomy === 'auto') {
      this.execute(trades)
      item.usedAfter = rule === 'daily' ? this.dailyUsed() : this.ddUsed()
    }
    this.push(item)
  }

  private beta(list = this.holdings) {
    const v = this.value(list)
    return list.reduce((a, h) => a + (h.qty * h.price * h.beta) / v, 0)
  }

  /** Sell a share of the positions with the highest risk contribution. */
  private planTrades(share: number): Trade[] {
    const risky = this.holdings
      .filter((h) => h.assetClass !== 'Cash' && h.assetClass !== 'Bond')
      .map((h) => ({ h, risk: h.qty * h.price * Math.abs(h.beta) * (0.5 + h.vol) }))
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 8)
    const trades: Trade[] = risky.map(({ h }) => ({ side: 'Sell', symbol: h.symbol, amount: h.qty * h.price * share }))
    const total = trades.reduce((a, t) => a + t.amount, 0)
    trades.push({ side: 'Buy', symbol: 'SGOV', amount: total })
    return trades
  }

  private simulate(trades: Trade[]) {
    const copy = this.holdings.map((h) => ({ ...h }))
    this.applyTo(copy, trades)
    return copy
  }

  private execute(trades: Trade[]) {
    this.applyTo(this.holdings, trades)
  }

  private applyTo(list: Holding[], trades: Trade[]) {
    for (const t of trades) {
      const h = list.find((x) => x.symbol === t.symbol)
      if (!h) continue
      h.qty += ((t.side === 'Buy' ? 1 : -1) * t.amount) / h.price
    }
  }

  private backfillDaily(endValue: number): Point[] {
    const r = rng(99)
    const n = 260
    const rets: number[] = []
    for (let i = 0; i < n; i++) {
      // a good year, a peak about three weeks ago, then a pullback
      const drift = i > n - 16 ? -0.0022 : 0.0011
      rets.push(drift + 0.0105 * gauss(r))
    }
    const vals = [1]
    for (const x of rets) vals.push(vals[vals.length - 1] * (1 + x))
    const k = endValue / vals[vals.length - 1]
    const out: Point[] = []
    const day = 24 * 60 * MIN
    for (let i = 0; i < vals.length - 1; i++) {
      out.push({ t: this.dayStart - (vals.length - 1 - i) * day * (7 / 5), v: vals[i] * k })
    }
    return out
  }

  /** Authored history so the feed has real precedent on first load (synthetic). */
  private seedHistory() {
    const day = 24 * 60 * MIN
    const v = this.open
    this.push({
      id: nid(),
      kind: 'action',
      t: this.dayStart - 3 * day + 5.2 * 60 * MIN,
      rule: 'drawdown',
      title: 'Trimmed NVDA, BTC, AMD',
      summary: 'Maximum drop at 61% of limit. Moved $96.4k to Treasuries.',
      why: [
        'You’d used 61% of your 10% maximum drop. I act at 60%.',
        'Semiconductors (−4.8%) and Crypto (−6.1%) caused most of the pullback from the peak.',
        'I sold $96.4k across 8 positions that add the most risk per dollar, and parked it in 0–3 month Treasuries.',
        'Portfolio beta dropped from 1.21 to 1.14.',
      ],
      trades: [],
      usedBefore: 0.61,
      usedAfter: 0.58,
      value: v * 1.004,
    })
    this.push({
      id: nid(),
      kind: 'market',
      t: this.dayStart - day + 1.5 * 60 * MIN,
      title: 'Down 0.92% in the first hour',
      summary: 'Semiconductors and Technology drove 74% of the move.',
      why: [
        'Semiconductors moved −2.6% and changed the portfolio by −0.41%.',
        'Technology moved −1.1% and changed the portfolio by −0.27%.',
        'Healthcare and bonds held up, which limited the loss.',
      ],
      value: v * 0.995,
    })
  }
}

export const sim = new Simulation()
