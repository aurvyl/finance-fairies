import { ArrowLeft, ArrowRight, Check, Hand, Mic, Pause, Sparkles, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { setSettings, useSettings } from '../api/settings'
import { compactMoney, pct } from '../engine/format'
import { sim } from '../engine/sim'
import type { Autonomy } from '../engine/types'
import { setOnboarded } from '../onboarding'
import { useSim } from '../store'
import { canListen, canSpeak } from '../voice'
import { FairyAvatar, FairyMark } from './FairyAvatar'

type Step = 'welcome' | 'limits' | 'mode' | 'extras'
const STEPS: { id: Exclude<Step, 'welcome'>; label: string }[] = [
  { id: 'limits', label: 'Your limits' },
  { id: 'mode', label: 'How your fairy acts' },
  { id: 'extras', label: 'AI agent and voice' },
]

const LIMITS = {
  dailyLoss: {
    label: 'Daily loss limit',
    help: 'The most you’re willing to lose in one day, measured from the morning’s value.',
    quote: (v: number) => `Don’t let me lose more than ${pct(v, v * 100 % 1 ? 1 : 0, false)} in a day`,
    min: 0.005,
    max: 0.08,
    step: 0.0025,
    digits: 1,
  },
  maxDrawdown: {
    label: 'Maximum drop',
    help: 'The most your portfolio may fall from its best day so far, however long that takes.',
    quote: (v: number) => `Don’t let my portfolio fall more than ${pct(v, 0, false)} from its peak`,
    min: 0.03,
    max: 0.4,
    step: 0.01,
    digits: 0,
  },
} as const

const MODES: { id: Autonomy; label: string; icon: typeof Zap; line: string; close: string; recommended?: boolean }[] = [
  {
    id: 'ask',
    label: 'Ask first',
    icon: Hand,
    line: 'Your fairy proposes trades and waits for your OK.',
    close: 'Near a limit, you get a proposal in Activity to approve or decline.',
    recommended: true,
  },
  {
    id: 'auto',
    label: 'Automatic',
    icon: Zap,
    line: 'Your fairy sells on its own, then tells you why.',
    close: 'Near a limit, it trims the riskiest holdings straight away.',
  },
  {
    id: 'paused',
    label: 'Paused',
    icon: Pause,
    line: 'Your fairy watches and explains, but never trades.',
    close: 'Near a limit, it warns you. Nothing is sold, even at the limit.',
  },
]

function Progress({ step }: { step: Step }) {
  const i = STEPS.findIndex((s) => s.id === step)
  return (
    <div className="ob-progress">
      <p className="ob-step">
        Step {i + 1} of {STEPS.length} <span aria-hidden>·</span> {STEPS[i].label}
      </p>
      <ol className="ob-bar" aria-hidden>
        {STEPS.map((s, j) => (
          <li key={s.id} className={j <= i ? 'on' : undefined} />
        ))}
      </ol>
    </div>
  )
}

function LimitPick({ k, value, onChange, base, actAt }: { k: keyof typeof LIMITS; value: number; onChange: (v: number) => void; base: number; actAt: number }) {
  const m = LIMITS[k]
  const id = `ob-${k}`
  return (
    <div className="ob-limit">
      <div className="ob-limit-head">
        <label htmlFor={id}>{m.label}</label>
        <output htmlFor={id} className="ob-limit-read">
          {pct(value, m.digits, false)}
        </output>
      </div>
      <p className="ob-help">{m.help}</p>
      <input
        id={id}
        type="range"
        min={m.min}
        max={m.max}
        step={m.step}
        value={value}
        aria-valuetext={pct(value, m.digits, false)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ '--p': `${((value - m.min) / (m.max - m.min)) * 100}%` } as CSSProperties}
      />
      <p className="ob-quote">“{m.quote(value)}”</p>
      <div className="ob-lane" aria-label={`On a ${compactMoney(base)} portfolio: your fairy steps in after a ${compactMoney(base * value * actAt)} fall, hard sell-off at ${compactMoney(base * value)}`}>
        <div className="lane-track">
          <div className="lane-safe" style={{ width: `${actAt * 100}%` }} />
          <div className="lane-trim" style={{ left: `${actAt * 100}%`, width: `${(1 - actAt) * 100}%` }} />
        </div>
        <div className="ob-lane-marks" aria-hidden>
          <span className="trim" style={{ left: `${actAt * 100}%` }}>
            <strong>Fairy steps in</strong> down {compactMoney(base * value * actAt)}
          </span>
          <span className="sell">
            <strong>Hard sell-off</strong> down {compactMoney(base * value)}
          </span>
        </div>
      </div>
    </div>
  )
}

function Shell({ step, children, onSkip }: { step: Step; children: ReactNode; onSkip: () => void }) {
  return (
    <div className="onboard">
      <header className="ob-top">
        <div className="brand">
          <FairyMark size={30} />
          <span>Finance Fairies</span>
        </div>
        {step !== 'extras' && (
          <button className="link" onClick={onSkip}>
            Skip setup
          </button>
        )}
      </header>
      <main className="ob-main" id="main">
        {step !== 'welcome' && <Progress step={step} />}
        {children}
      </main>
      <p className="ob-foot">Prices, holdings and trades in this app are simulated. Finance Fairies is not investment advice.</p>
    </div>
  )
}

/** First-run setup: the two limits, the agent mode, then the optional AI agent and voice. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const s = useSim()
  const settings = useSettings()
  const [step, setStep] = useState<Step>('welcome')
  const [dailyLoss, setDailyLoss] = useState(s.guardrails.dailyLoss)
  const [maxDrawdown, setMaxDrawdown] = useState(s.guardrails.maxDrawdown)
  const [mode, setMode] = useState<Autonomy>('ask')
  const [useAgent, setUseAgent] = useState(settings.useAgent)
  const [readAloud, setReadAloud] = useState(settings.readAloud && canSpeak)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    document.title = 'Set up · Finance Fairies'
  }, [])

  const skip = () => {
    setOnboarded(true)
    onDone()
  }
  const finish = () => {
    sim.setGuardrails({ dailyLoss, maxDrawdown })
    sim.setAutonomy(mode)
    setSettings({ useAgent, readAloud })
    setOnboarded(true)
    onDone()
  }

  const order: Step[] = ['welcome', 'limits', 'mode', 'extras']
  const next = () => (step === 'extras' ? finish() : setStep(order[order.indexOf(step) + 1]))
  const back = () => setStep(order[Math.max(0, order.indexOf(step) - 1)])

  const nav = (cta: string) => (
    <div className="ob-nav">
      <button type="button" className="btn ghost" onClick={back}>
        <ArrowLeft size={16} aria-hidden /> Back
      </button>
      <button type="submit" className="btn primary">
        {cta} {step === 'extras' ? <Check size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}
      </button>
    </div>
  )

  return (
    <Shell step={step} onSkip={skip}>
      <form
        key={step}
        className={`ob-card ob-s-${step}`}
        onSubmit={(e) => {
          e.preventDefault()
          next()
        }}
      >
        {step === 'welcome' && (
          <>
            <FairyAvatar size={64} state="idle" />
            <h1 ref={heading} tabIndex={-1}>
              Let’s set up your fairy
            </h1>
            <p className="ob-lede">
              Your fairy watches your whole portfolio and keeps it inside two limits you choose. When a limit gets close, it sells the riskiest holdings and explains
              why, in words or out loud.
            </p>
            <ul className="ob-list">
              <li>Choose how much you’re willing to lose</li>
              <li>Decide whether your fairy asks first or acts on its own</li>
              <li>Turn on the AI agent and voice if you want them</li>
            </ul>
            <p className="ob-help">Takes about a minute. You can change all of it later in Guardrails and Settings.</p>
            <div className="ob-nav">
              <button type="button" className="btn ghost" onClick={skip}>
                Use the defaults
              </button>
              <button type="submit" className="btn primary">
                Start setup <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </>
        )}

        {step === 'limits' && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              How much are you willing to lose?
            </h1>
            <p className="ob-lede">
              Your fairy measures the whole portfolio, not single holdings. It starts selling at {pct(s.guardrails.actAt, 0, false)} of either limit, so it acts
              before you reach the line.
            </p>
            <LimitPick k="dailyLoss" value={dailyLoss} onChange={setDailyLoss} base={s.value} actAt={s.guardrails.actAt} />
            <LimitPick k="maxDrawdown" value={maxDrawdown} onChange={setMaxDrawdown} base={s.value} actAt={s.guardrails.actAt} />
            <p className="ob-help">Amounts use the {compactMoney(s.value)} demo portfolio.</p>
            {nav('Continue')}
          </>
        )}

        {step === 'mode' && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              How should your fairy act?
            </h1>
            <p className="ob-lede">This decides what happens when a limit gets close. You can switch at any time from Guardrails.</p>
            <fieldset className="ob-modes">
              <legend className="sr-only">Agent mode</legend>
              {MODES.map((m) => (
                <label key={m.id} className={`ob-mode ${mode === m.id ? 'on' : ''}`}>
                  <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span className="ob-mode-icon" aria-hidden>
                    <m.icon size={18} />
                  </span>
                  <span className="ob-mode-text">
                    <span className="ob-mode-name">
                      {m.label}
                      {m.recommended && <span className="badge">Recommended to start</span>}
                    </span>
                    <span>{m.line}</span>
                    <span className="ob-help">{m.close}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {nav('Continue')}
          </>
        )}

        {step === 'extras' && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              AI agent and voice
            </h1>
            <p className="ob-lede">Both are optional. Your limits work the same with them off.</p>
            <section className="ob-extra" aria-labelledby="ob-ai">
              <h2 id="ob-ai">
                <Sparkles size={16} aria-hidden /> AI agent
              </h2>
              <p className="ob-help">
                In Replay and What-if, an AI model proposes its own plan at every limit check. The engine re-checks that plan against your limits and keeps
                whichever is safer. It needs the engine connected; pick the model in Settings.
              </p>
              <label className="toggle">
                <input type="checkbox" checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} />
                <span className="toggle-ui" aria-hidden />
                Let the AI agent propose plans
              </label>
            </section>
            <section className="ob-extra" aria-labelledby="ob-voice">
              <h2 id="ob-voice">
                <Mic size={16} aria-hidden /> Voice
              </h2>
              <p className="ob-help">
                {canListen
                  ? 'Press Talk to your fairy, then hold the mic button or Space to ask a question out loud: “Why did you sell?”'
                  : 'This browser can’t listen, so you’ll type questions to your fairy. Chrome, Edge and Safari support talking.'}
              </p>
              <label className={`toggle ${canSpeak ? '' : 'off'}`}>
                <input type="checkbox" checked={readAloud} disabled={!canSpeak} onChange={(e) => setReadAloud(e.target.checked)} />
                <span className="toggle-ui" aria-hidden />
                Read answers aloud
              </label>
              {!canSpeak && <p className="ob-help">This browser can’t read answers aloud.</p>}
            </section>
            <dl className="ob-recap" aria-label="Your setup">
              <div>
                <dt>Daily loss limit</dt>
                <dd>{pct(dailyLoss, 1, false)}</dd>
              </div>
              <div>
                <dt>Maximum drop</dt>
                <dd>{pct(maxDrawdown, 0, false)}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{MODES.find((m) => m.id === mode)!.label}</dd>
              </div>
            </dl>
            {nav('Finish setup')}
          </>
        )}
      </form>
    </Shell>
  )
}
