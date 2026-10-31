import { ArrowDownRight, ArrowUpRight, Newspaper, X } from 'lucide-react'
import { clock, compactMoney, pct } from '../engine/format'
import { hitFor, listOf, matches, SCENARIOS, type HitGroup, type Scenario } from '../engine/scenarios'
import { sim } from '../engine/sim'
import type { Holding, ScenarioState, Snapshot } from '../engine/types'
import { useUI } from '../store'
import { FairyMark } from './FairyAvatar'
import './story.css'

const TICK_MIN = 2
const MIN = 60_000

/** Value-weighted move of a group of holdings since the story began. */
function groupMove(holdings: Holding[], st: ScenarioState, pick: (h: Holding) => boolean) {
  let from = 0
  let to = 0
  for (const h of holdings) {
    if (!pick(h)) continue
    const p0 = st.startPrices[h.symbol]
    if (!p0) continue
    from += h.qty * p0
    to += h.qty * h.price
  }
  return from > 0 ? to / from - 1 : 0
}

const fallWord = (m: number) => (m <= -0.06 ? 'Hit hard' : m <= -0.02 ? 'Falling' : m < -0.003 ? 'Slipping' : m > 0.003 ? 'Rising' : 'Holding')

function Timeline({ sc, st }: { sc: Scenario; st: ScenarioState }) {
  const steps = [...sc.beats.map((b) => ({ ...b, key: b.title })), { at: sc.ticks, title: sc.after.title, text: sc.after.text, key: 'after' }]
  const current = st.done ? steps.length - 1 : st.beat
  return (
    <ol className="story-steps" aria-label="How it spread">
      {steps.map((b, i) => {
        const state = i < current ? 'past' : i === current ? 'now' : 'next'
        return (
          <li key={b.key} className={`step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden />
            <time>{state === 'next' ? 'Next' : clock(st.startedAt + b.at * TICK_MIN * MIN)}</time>
            <strong>{b.title}</strong>
            {state !== 'next' && <p>{b.text}</p>}
          </li>
        )
      })}
    </ol>
  )
}

function HitRow({ g, move, haven, scale }: { g: HitGroup; move: number; haven?: boolean; scale: number }) {
  const Dir = move >= 0 ? ArrowUpRight : ArrowDownRight
  const tip = `${g.label}: ${pct(move, 1)} since the news`
  return (
    <li className={`hit ${haven ? 'haven' : ''}`} title={tip}>
      <div className="hit-head">
        <span className={`hit-dir ${move >= 0 ? 'up' : 'down'}`} aria-hidden>
          <Dir size={15} />
        </span>
        <strong>{g.label}</strong>
        <span className="hit-word">{fallWord(move)}</span>
      </div>
      <span className="hit-track" role="img" aria-label={tip}>
        <span style={{ width: `${Math.min(1, Math.abs(move) / scale) * 100}%` }} />
      </span>
      <p>{g.why}</p>
    </li>
  )
}

/**
 * The story behind a simulated sell-off: the headline, how the panic spread, which of the
 * user's holdings it reached and why, and what the fairy did about it. Carries the app's usual simulated tag.
 */
export function ScenarioStory({ s }: { s: Snapshot }) {
  const ui = useUI()
  const st = s.scenario
  if (!st) return null
  const sc = SCENARIOS[st.id]
  const groups = sc.hits.filter((g) => g.from <= st.beat)
  const moves = groups.map((g) => groupMove(s.holdings, st, (h) => hitFor(sc, h, st.beat)?.id === g.id))
  const showHaven = sc.haven.from <= st.beat || st.done
  const havenMove = groupMove(s.holdings, st, (h) => matches(h, sc.haven.match) && h.assetClass !== 'Cash')
  const scale = Math.max(0.04, ...moves.map(Math.abs))

  const actions = s.activity.filter((a) => a.kind === 'action' && a.t >= st.startedAt)
  const sold = actions.filter((a) => !a.pending).flatMap((a) => (a.trades ?? []).filter((t) => t.side === 'Sell'))
  const soldAmt = sold.reduce((a, t) => a + t.amount, 0)
  const soldGroups = [...new Set(sold.map((t) => s.holdings.find((h) => h.symbol === t.symbol)).map((h) => (h ? hitFor(sc, h, sc.beats.length)?.noun : undefined)).filter(Boolean))] as string[]
  const pending = actions.find((a) => a.pending)

  return (
    <section className="panel story" id="story" aria-labelledby="story-h">
      <header className="story-head">
        <p className="story-kicker">
          <Newspaper size={14} aria-hidden /> Breaking
          <span className="demo-tag" title="This news, and the prices and trades it causes, are simulated">
            Simulated
          </span>
        </p>
        <button className="icon-btn sm" onClick={() => sim.clearScenario()} aria-label="Hide this story" title="Hide this story">
          <X size={16} aria-hidden />
        </button>
      </header>
      <h2 id="story-h">{sc.headline}</h2>
      <p className="story-dek">{sc.dek}</p>

      <div className="story-body">
        <div>
          <h3 className="story-sub">How it spread</h3>
          <Timeline sc={sc} st={st} />
        </div>
        <div>
          <h3 className="story-sub">What it hit in your portfolio</h3>
          <ul className="hits">
            {groups.map((g, i) => (
              <HitRow key={g.id} g={g} move={moves[i]} scale={scale} />
            ))}
            {showHaven && <HitRow g={sc.haven} move={havenMove} scale={scale} haven />}
          </ul>
        </div>
      </div>

      <div className="story-fairy">
        <span className="story-fairy-mark" aria-hidden>
          <FairyMark size={22} />
        </span>
        <p>
          {pending ? (
            <>
              <strong>Your fairy wants to sell</strong> some of the holdings this story hits hardest, and is waiting for your OK in Activity.
            </>
          ) : soldAmt > 0 ? (
            <>
              <strong>Your fairy sold {compactMoney(soldAmt)}</strong>
              {soldGroups.length ? `, mostly ${listOf(soldGroups.slice(0, 3))}` : ''}. {sc.fairy}
            </>
          ) : s.autonomy === 'paused' ? (
            <>
              <strong>Your fairy is paused</strong>, so it is only watching this one.
            </>
          ) : (
            <>
              <strong>Your fairy is watching.</strong> If the fall eats into your limits, it will sell the holdings this story hits hardest first.
            </>
          )}
        </p>
        {pending ? (
          <button
            className="btn ghost sm"
            onClick={() => {
              ui.setView('activity')
              ui.setExpanded(pending.id)
            }}
          >
            Review
          </button>
        ) : (
          soldAmt > 0 && (
            <button className="btn ghost sm" onClick={() => ui.openVoice('Why did you sell?')}>
              Ask why
            </button>
          )
        )}
      </div>

    </section>
  )
}
