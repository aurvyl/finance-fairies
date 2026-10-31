import { compactMoney, pct } from './format'
import { sim } from './sim'
import type { ActivityItem, Snapshot } from './types'

export interface Answer {
  text: string
  /** where the answer came from, shown quietly under it */
  source: 'agent' | 'claude' | 'engine'
  model?: string
  /** an item in the feed the answer is about, so the UI can highlight it */
  focus?: string
}

/** Turn a sentence like "don't let me lose more than 3% in a day" into a guardrail change. */
export function parseRule(q: string): { dailyLoss?: number; maxDrawdown?: number } | null {
  if (/^\s*(why|what|how|did|does|is|was|when|where|who)\b/i.test(q)) return null
  const m = q.match(/(\d+(?:\.\d+)?)\s*(%|percent|per cent)/i)
  if (!m) return null
  if (!/(lose|loss|drop|fall|down|below|limit|more than|set)/i.test(q)) return null
  const f = parseFloat(m[1]) / 100
  if (!(f > 0 && f < 0.6)) return null
  if (/(day|daily|today|session|24)/i.test(q)) return { dailyLoss: f }
  return { maxDrawdown: f }
}

function lastAction(s: Snapshot, q: string): ActivityItem | undefined {
  const sym = s.holdings.find((h) => new RegExp(`\\b${h.symbol.replace('.', '\\.')}\\b`, 'i').test(q) || q.toLowerCase().includes(h.name.toLowerCase()))
  const actions = s.activity.filter((a) => a.kind === 'action')
  if (sym) return actions.find((a) => a.trades?.some((t) => t.symbol === sym.symbol) || a.title.includes(sym.symbol)) ?? actions[0]
  return actions[0]
}

export function localAnswer(q: string, s: Snapshot): Answer {
  const text = q.trim()
  const change = s.value / s.open - 1
  const dd = 1 - s.value / s.highWater
  const dailyUsed = Math.max(0, -change) / s.guardrails.dailyLoss
  const ddUsed = Math.max(0, dd) / s.guardrails.maxDrawdown

  const rule = parseRule(text)
  if (rule) {
    sim.setGuardrails(rule)
    if (rule.dailyLoss !== undefined)
      return { source: 'agent', text: `Done. I’ll keep any single day’s loss under ${pct(rule.dailyLoss, 1, false)}, and start reducing risk at ${pct(rule.dailyLoss * s.guardrails.actAt, 2, false)}. Today you’re ${pct(change)}.` }
    return { source: 'agent', text: `Done. I’ll keep the portfolio from falling more than ${pct(rule.maxDrawdown!, 0, false)} below its peak of ${compactMoney(s.highWater)}. That floor is ${compactMoney(s.highWater * (1 - rule.maxDrawdown!))}.` }
  }
  if (/\b(pause|stop trading|hold off|don.?t trade)\b/i.test(text)) {
    sim.setAutonomy('paused')
    return { source: 'agent', text: 'Paused. I’ll keep watching and explaining, but I won’t place any trades until you resume me.' }
  }
  if (/\b(ask me|ask first|check with me|approval)\b/i.test(text)) {
    sim.setAutonomy('ask')
    return { source: 'agent', text: 'Okay. When a limit gets close I’ll propose the trades and wait for your go-ahead.' }
  }
  if (/\b(resume|go ahead|automatic|take over|unpause)\b/i.test(text)) {
    sim.setAutonomy('auto')
    return { source: 'agent', text: 'Back on. I’ll act on my own when a limit gets close and tell you why.' }
  }
  if (/\b(why|explain|reason)\b.*\b(sell|sold|trim|cut|buy|bought|trade|action|do|did|move(d)? .* to)\b/i.test(text) || /\b(what|why) (did|have) you (just )?(do|done|did)\b/i.test(text) || /\bwhy did you\b/i.test(text)) {
    const a = lastAction(s, text)
    if (!a) return { source: 'agent', text: 'I haven’t needed to trade yet. Both limits have plenty of room.' }
    return { source: 'agent', focus: a.id, text: `${a.title}. ${a.why.join(' ')}` }
  }
  if (/\b(what happened|why .*(down|up|fall|fell|drop|move|moving|red|green|crash)|market|crash|news)\b/i.test(text)) {
    const story = sim.activeScenario()
    if (story) {
      const { sc, state } = story
      const beat = state.done ? sc.after : sc.beats[state.beat]
      return {
        source: 'agent',
        text: `In this simulated scenario, ${sc.headline.replace(/^./, (c) => c.toLowerCase())}. ${beat.text} You’re ${pct(change)} today.`,
      }
    }
    const moves = sim.sectorMoves('open')
    const worst = moves.slice(0, 2)
    const best = moves[moves.length - 1]
    const dir = change < 0 ? 'down' : 'up'
    return {
      source: 'agent',
      text: `You’re ${dir} ${pct(Math.abs(change), 2, false)} today, ${compactMoney(s.value - s.open)}. ${worst
        .map((m) => `${m.sector} moved ${pct(m.pct)}, which cost ${pct(Math.abs(m.contribution), 2, false)}`)
        .join('; ')}. ${best.sector} helped most at ${pct(best.pct)}.`,
    }
  }
  if (/\b(close|headroom|limit|safe|risk|room|budget|guardrail)\b/i.test(text)) {
    return {
      source: 'agent',
      text: `You’ve used ${pct(dailyUsed, 0, false)} of today’s ${pct(s.guardrails.dailyLoss, 1, false)} loss budget and ${pct(ddUsed, 0, false)} of your ${pct(s.guardrails.maxDrawdown, 0, false)} maximum drop. I step in at ${pct(s.guardrails.actAt, 0, false)} of either.`,
    }
  }
  if (/\b(best|worst|top|biggest|movers?|winners?|losers?)\b/i.test(text)) {
    const ranked = [...s.holdings].filter((h) => h.assetClass !== 'Cash').sort((a, b) => a.price / a.open - b.price / b.open)
    const lo = ranked.slice(0, 2)
    const hi = ranked.slice(-2).reverse()
    return {
      source: 'agent',
      text: `Biggest fallers: ${lo.map((h) => `${h.symbol} ${pct(h.price / h.open - 1, 1)}`).join(', ')}. Biggest gainers: ${hi.map((h) => `${h.symbol} ${pct(h.price / h.open - 1, 1)}`).join(', ')}.`,
    }
  }
  return {
    source: 'agent',
    text: `Your portfolio is ${compactMoney(s.value)}, ${pct(change)} today across ${s.holdings.length} positions. You can ask why it moved, what I did and why, or tell me a rule like “don’t let me lose more than 3% in a day”.`,
  }
}

/** Compact, numbers-only context for the model. Never includes anything the user did not see. */
export function contextFor(s: Snapshot) {
  const moves = sim.sectorMoves('open')
  return {
    value: Math.round(s.value),
    dayChangePct: +((s.value / s.open - 1) * 100).toFixed(2),
    drawdownFromPeakPct: +((1 - s.value / s.highWater) * 100).toFixed(2),
    guardrails: { maxDrawdownPct: s.guardrails.maxDrawdown * 100, dailyLossPct: s.guardrails.dailyLoss * 100, actAtShareOfLimit: s.guardrails.actAt },
    autonomy: s.autonomy,
    sectorsToday: moves.map((m) => ({ sector: m.sector, movePct: +(m.pct * 100).toFixed(2), contributionPct: +(m.contribution * 100).toFixed(3) })),
    recentActivity: s.activity.slice(0, 8).map((a) => ({ kind: a.kind, title: a.title, summary: a.summary, why: a.why })),
    positions: s.holdings.length,
    ...scenarioContext(),
  }
}

/** The fictional story behind a demo sell-off, so a model can explain the cause and say it is made up. */
function scenarioContext() {
  const a = sim.activeScenario()
  if (!a) return {}
  const { sc, state } = a
  return {
    simulatedScenario: {
      fictional: true,
      headline: sc.headline,
      storySoFar: sc.beats.slice(0, state.beat + 1).map((b) => `${b.title}: ${b.text}`).concat(state.done ? [`${sc.after.title}: ${sc.after.text}`] : []),
      hit: sc.hits.filter((g) => g.from <= state.beat).map((g) => `${g.label}: ${g.why}`),
    },
  }
}

import { engine } from '../api/client'
import { getConnection } from '../api/useEngine'

const VOICE_STYLE =
  'How to answer: you are talking out loud to the portfolio owner, like a calm friend who manages their money. Answer the question directly in your first sentence. Use two or three short sentences, everyday words and round numbers (say "about 1%" or "around $2.5 million"), and name at most two causes. No jargon, lists, percentages to two decimals or mention of models, tools or data. If the question is unclear, answer the most likely meaning without pointing that out.'

let remote: boolean | null = null

export async function remoteAvailable() {
  if (remote !== null) return remote
  try {
    const r = await fetch('/api/health')
    remote = r.ok && (await r.json()).claude === true
  } catch {
    remote = false
  }
  return remote
}

/**
 * Commands (rules, pause/resume) always run locally so they are instant and exact.
 * Open questions go to Claude when the server has a key, and fall back to the local explainer.
 */
export async function ask(q: string, s: Snapshot): Promise<Answer> {
  const local = localAnswer(q, s)
  const isCommand = parseRule(q) || /\b(pause|resume|ask me|ask first|unpause|automatic|stop trading)\b/i.test(q)
  if (isCommand) return local
  // the Guardian engine answers with its AI agent (Gemini by default) when it is connected
  if (getConnection().state === 'online') {
    try {
      const j = await engine.ask(`${q}\n\n${VOICE_STYLE}`, contextFor(s))
      if (j.answer) return { source: 'engine', text: j.answer, focus: local.focus, model: j.model }
    } catch {
      /* fall through to the optional Claude route, then the local explainer */
    }
  }
  if (!(await remoteAvailable())) return local
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q, context: contextFor(s) }),
    })
    if (!r.ok) return local
    const j = (await r.json()) as { answer?: string }
    return j.answer ? { source: 'claude', text: j.answer, focus: local.focus } : local
  } catch {
    return local
  }
}
