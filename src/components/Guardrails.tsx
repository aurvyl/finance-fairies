import { Check, Hand, Pause, Pencil, Send, Zap } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { localAnswer } from '../engine/ask'
import { compactMoney, pct } from '../engine/format'
import { sim } from '../engine/sim'
import type { Autonomy, Snapshot } from '../engine/types'
import { useUI } from '../store'

type Key = 'dailyLoss' | 'maxDrawdown'

const META: Record<Key, { label: string; quote: (v: number) => string; min: number; max: number; step: number; digits: number }> = {
  dailyLoss: {
    label: 'Daily loss limit',
    quote: (v) => `Don’t let me lose more than ${pct(v, v * 100 % 1 ? 1 : 0, false)} in a day`,
    min: 0.005,
    max: 0.08,
    step: 0.0025,
    digits: 2,
  },
  maxDrawdown: {
    label: 'Maximum drop',
    quote: (v) => `Don’t let my portfolio fall more than ${pct(v, 0, false)} from its peak`,
    min: 0.03,
    max: 0.4,
    step: 0.01,
    digits: 0,
  },
}

function Rule({ k, s }: { k: Key; s: Snapshot }) {
  const ui = useUI()
  const m = META[k]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.guardrails[k])
  const limit = editing ? draft : s.guardrails[k]

  const lossNow = k === 'dailyLoss' ? Math.max(0, 1 - s.value / s.open) : Math.max(0, 1 - s.value / s.highWater)
  const used = Math.min(1.2, lossNow / limit)
  const base = k === 'dailyLoss' ? s.open : s.highWater
  const room = Math.max(0, s.value - base * (1 - limit))
  const tone = used >= 0.85 ? 'crit' : used >= s.guardrails.actAt ? 'warn' : used >= s.guardrails.actAt * 0.75 ? 'near' : 'ok'
  const status =
    used >= 1 ? 'Limit reached' : used >= s.guardrails.actAt ? 'Agent is reducing risk' : used >= s.guardrails.actAt * 0.75 ? 'Getting close' : 'Plenty of room'

  const commit = () => {
    sim.setGuardrails({ [k]: draft })
    ui.setPreview({})
    setEditing(false)
  }
  const cancel = () => {
    setDraft(s.guardrails[k])
    ui.setPreview({})
    setEditing(false)
  }

  return (
    <section className={`rule tone-${tone}`} aria-labelledby={`rule-${k}`}>
      <header className="rule-head">
        <h3 id={`rule-${k}`}>{m.label}</h3>
        <span className="rule-status">
          <span className="status-dot" aria-hidden />
          {status}
        </span>
      </header>
      <p className="rule-quote">“{m.quote(limit)}”</p>

      <div className="rule-read">
        <span className="rule-used">{pct(lossNow, 2, false)}</span>
        <span className="rule-of">of {pct(limit, m.digits, false)}</span>
        <span className="rule-left">
          {compactMoney(room)} <span>until the limit</span>
        </span>
      </div>

      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label={`${m.label} used`}>
        <div className="meter-fill" style={{ transform: `scaleX(${Math.min(1, used)})` }} />
        <div className="meter-act" style={{ left: `${s.guardrails.actAt * 100}%` }} title="The agent starts acting here" />
      </div>
      <div className="meter-scale" aria-hidden>
        <span>0</span>
        <span style={{ left: `${s.guardrails.actAt * 100}%` }}>agent acts</span>
        <span>limit</span>
      </div>

      {editing ? (
        <div className="rule-edit">
          <label className="slider">
            <span className="sr-only">{m.label}</span>
            <input
              type="range"
              min={m.min}
              max={m.max}
              step={m.step}
              value={draft}
              autoFocus
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setDraft(v)
                ui.setPreview({ [k]: v })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') cancel()
              }}
              style={{ '--p': `${((draft - m.min) / (m.max - m.min)) * 100}%` } as CSSProperties}
            />
            <output>{pct(draft, m.digits, false)}</output>
          </label>
          <div className="row-actions">
            <button className="btn ghost sm" onClick={cancel}>
              Cancel
            </button>
            <button className="btn solid sm" onClick={commit}>
              <Check size={14} aria-hidden /> Save
            </button>
          </div>
        </div>
      ) : (
        <button className="btn ghost sm rule-change" onClick={() => setEditing(true)}>
          <Pencil size={13} aria-hidden /> Change limit
        </button>
      )}
    </section>
  )
}

const MODES: { id: Autonomy; label: string; icon: typeof Zap; hint: string }[] = [
  { id: 'auto', label: 'Automatic', icon: Zap, hint: 'Acts on its own and explains after' },
  { id: 'ask', label: 'Ask first', icon: Hand, hint: 'Proposes trades and waits for you' },
  { id: 'paused', label: 'Paused', icon: Pause, hint: 'Watches and explains, never trades' },
]

export function Guardrails({ s }: { s: Snapshot }) {
  const [text, setText] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const mode = MODES.find((m) => m.id === s.autonomy)!

  return (
    <div className="panel guardrails">
      <header className="panel-head">
        <h2>Your guardrails</h2>
      </header>
      <Rule k="dailyLoss" s={s} />
      <Rule k="maxDrawdown" s={s} />

      <div className="mode">
        <div className="mode-label" id="mode-label">
          Agent
        </div>
        <div className="segmented" role="radiogroup" aria-labelledby="mode-label">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={s.autonomy === m.id} onClick={() => sim.setAutonomy(m.id)}>
              <m.icon size={14} aria-hidden />
              {m.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{mode.hint}</p>
      </div>

      <form
        className="rule-say"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          setReply(localAnswer(text, sim.getSnapshot()).text)
          setText('')
        }}
      >
        <label htmlFor="rule-input" className="sr-only">
          Tell the agent a rule
        </label>
        <input id="rule-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say a rule: “never lose 3% in a day”" />
        <button className="icon-btn" aria-label="Set rule" disabled={!text.trim()}>
          <Send size={15} aria-hidden />
        </button>
      </form>
      {reply && (
        <p className="rule-reply" role="status">
          {reply}
        </p>
      )}
    </div>
  )
}
