import { ChevronDown, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettings } from '../api/settings'
import { pct } from '../engine/format'
import { setOnboarded } from '../onboarding'
import { useSim } from '../store'

function Topic({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="help-topic" open={open}>
      <summary>
        {title}
        <ChevronDown size={16} aria-hidden />
      </summary>
      <div className="help-body">{children}</div>
    </details>
  )
}

/** Plain-language help for the rules, the step-in point, the speed checks, agent modes and voice. */
export function HelpSection() {
  const s = useSim()
  const settings = useSettings()
  const g = s.guardrails
  const act = pct(g.actAt, 0, false)

  return (
    <section className="panel span-all help" aria-labelledby="help-h" id="help">
      <header className="panel-head">
        <h2 id="help-h">Help</h2>
        <button className="btn ghost sm" onClick={() => setOnboarded(false)}>
          <RotateCcw size={14} aria-hidden /> Run setup again
        </button>
      </header>
      <p className="lede">How your fairy keeps your portfolio inside your limits, and what each setting does.</p>

      <div className="help-topics">
        <Topic title="Your two limits" open>
          <dl className="help-defs">
            <div>
              <dt>Daily loss limit · yours is {pct(g.dailyLoss, 1, false)}</dt>
              <dd>The most the whole portfolio may lose in one day, measured from that morning’s value. It resets each trading day.</dd>
            </div>
            <div>
              <dt>Maximum drop · yours is {pct(g.maxDrawdown, 0, false)}</dt>
              <dd>
                The most the portfolio may fall from its best day so far (its peak), however many days that takes. It only resets once you recover to a new
                peak.
              </dd>
            </div>
          </dl>
          <p>Both are measured across every holding together, not position by position. Change them in Guardrails; the chart shows the new lines before you save.</p>
        </Topic>

        <Topic title={`Fairy steps in at ${act}`}>
          <p>Your fairy doesn’t wait for the limit. It acts in three steps, on whichever limit is closest:</p>
          <ol className="help-steps">
            <li>
              <strong>At {act} of a limit</strong>, it sells a slice of the holdings that add the most risk for their size and parks the money in short-dated
              Treasuries. With your daily limit that’s a fall of {pct(g.dailyLoss * g.actAt, 1, false)} in a day.
            </li>
            <li>
              <strong>At 85%</strong>, it sells a deeper slice.
            </li>
            <li>
              <strong>At 100%, the hard sell-off</strong>, it moves most of the risk out and adds none back until the next day (daily limit) or until you recover
              (maximum drop).
            </li>
          </ol>
          <p>
            On Overview, the amber stretch of each lane is the zone between “Fairy steps in” and the hard sell-off. Replay and What-if run on the Guardian engine,
            which draws its own lines from your limits; Guardrails lists them under “When the engine steps in”.
          </p>
        </Topic>

        <Topic title="How fast it’s falling">
          <p>A fast fall matters as much as a deep one, so the fairy also checks speed. Each check is shown on Overview and lights up when it’s crossed:</p>
          <dl className="help-defs">
            <div>
              <dt>Today</dt>
              <dd>Today’s move against your daily loss limit ({pct(-g.dailyLoss, 1)}). A day this bad is treated as a shock day.</dd>
            </div>
            <div>
              <dt>Worst holding</dt>
              <dd>Your weakest holding today, flagged once it’s down 7% or more.</dd>
            </div>
            <div>
              <dt>Swings vs normal</dt>
              <dd>How big the last week’s daily moves are compared with the last three months. Flagged at 1.8 times normal.</dd>
            </div>
          </dl>
          <p>The engine also keeps the 99% worst likely day inside your daily limit. Any of these can make it reduce risk before a limit is {act} used.</p>
        </Topic>

        <Topic title="Agent modes">
          <dl className="help-defs">
            <div>
              <dt>Ask first</dt>
              <dd>The fairy proposes trades in Activity and waits for you to approve or decline them.</dd>
            </div>
            <div>
              <dt>Automatic</dt>
              <dd>The fairy trades on its own as soon as a step is reached, then explains each trade with the numbers behind it.</dd>
            </div>
            <div>
              <dt>Paused</dt>
              <dd>The fairy keeps watching and explaining, but never trades, even at a limit.</dd>
            </div>
          </dl>
          <p>
            You’re on <strong>{{ auto: 'Automatic', ask: 'Ask first', paused: 'Paused' }[s.autonomy]}</strong>. Switch at the bottom of Guardrails.
          </p>
        </Topic>

        <Topic title="AI agent">
          <p>
            Off by default, and currently <strong>{settings.useAgent ? 'on' : 'off'}</strong>. When on, an AI model proposes its own plan at every limit check in
            Replay and What-if. The engine checks that plan with the same rules as its own and keeps whichever is safer, so the AI can never take more risk than
            your limits allow. It needs the engine connected. Choose the model above.
          </p>
        </Topic>

        <Topic title="Voice">
          <p>
            Press <strong>Talk to your fairy</strong>, then hold the mic button, or hold Space, and ask out loud: “Why did you sell?” or “How close am I to my
            limit?”. You can also type. With <strong>Read answers aloud</strong> on, the fairy speaks its answer and highlights each word as it goes.
          </p>
        </Topic>

        <Topic title="Is this real money?">
          <p>
            No. Prices, holdings and trades are simulated, and no real trades are placed. Finance Fairies is a demo, not investment advice.
          </p>
        </Topic>
      </div>
    </section>
  )
}
