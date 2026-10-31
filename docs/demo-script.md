# Finance Fairies: demo script (4–5 minutes)

The story follows Alex through a crash: fear, then curiosity, then trust, then relief. The slides carry the story and the app proves it. Open [`presentation.html`](../presentation.html) in a browser and press **N** to see these lines and cues under each slide, and **F** for full screen.

## Before you go on stage

1. Start the engine: `cd engine && uv run --project . uvicorn guardian.api:app --port 8000`.
2. Start the app with `npm run dev`, or serve the clickable build with `npx serve design/artifact`.
3. In **Settings**, check that the engine shows as connected and turn on **Let the AI agent propose plans in replays and what-ifs**. Leave live news off: the recorded Gemini answers only load instantly with the default settings.
4. Run What-if → **NVIDIA falls 15% (29 Oct)** once to check that it returns instantly.
5. Reload the app so Overview starts calm. Open the presentation in a second tab or window.

Alex's numbers (£100,000, 150 assets, −7.2%) are illustrative. The app's Overview uses a synthetic demo book of about $2.5M and 126 positions, so talk about "Alex's portfolio" there and don't read the app's dollar figures aloud.

## Run of show

| Time | Slide | Say (short version) | Do in the app |
|---|---|---|---|
| 0:00 | 1 · Cold open | "It's 9:30 AM. The market just crashed. You've lost £7,200. You own 150 investments… One rule: don't let my portfolio lose more than 10%. What if your portfolio already knew what to do?" | Nothing. Don't introduce the team. |
| 0:20 | 2 · Meet Alex | 150 assets, £100k. Alex cares about one thing: not losing what they built. | |
| 0:35 | 3 · The problem | Platforms tell you what happened and leave the hardest decision to you. | Pause before the next slide. |
| 0:50 | 4 · Reveal | "Meet Finance Fairies, your personal AI financial guardian." | |
| 1:00 | 5 · Rules | Read Alex's four rules. "Alex sets the boundaries; the fairy takes care of the complexity." | **Switch to the app.** Guardrails → type *never lose more than 2% in a day* into "Tell the agent a rule" → Set rule. Point at the limit lines and the headroom meters. Agent mode: **Automatic**. |
| 1:30 | 6 · The crisis | "Monday morning, a geopolitical shock… Alex is down £7,200, just £2,800 from the limit. It doesn't send a notification. It starts thinking." | Overview → **Simulate a sell-off**. Within about 10–15 s the "Sell-off starting in chips and crypto" entry appears and the line falls toward the limit. |
| 2:15 | 7 · The agent thinks | **Slow down.** It looks at the whole portfolio, finds the concentration, tests interventions against Alex's rules, and picks a rotation. "It isn't predicting the next winner. It's protecting the portfolio as a whole." | When the "Trimmed …" entry and its diamond marker appear, open **Why I did this**. |
| 2:50 | 8 · The agent acts | "This is the real engine. Gemini proposes, the engine checks: volatility 22.6% → 12.9%, worst likely day 3.3% → 1.9%. One leg is above the auto limit, so it asks first." | What-if → **NVIDIA falls 15% (29 Oct)** → **See what Guardian would do**. Point at the Gemini card, "Agrees with the engine", the line "Gemini proposed, the engine checked it", and "Needs your approval". |
| 3:30 | 9 · The explanation | "Autonomy without transparency is dangerous. Let's ask it why." Read the fairy's answer. "Every action is traceable. Every decision has a reason." | **Talk to your fairy** → hold the mic (or Space) → "What did you just do, and why?" The answer is spoken with each word highlighted. If the mic fails, type the question. |
| 4:05 | 10 · Proof | Early 2025 replay on real prices: buy and hold fell 18.1% with 10 days past −2%; the guardian fell at most 7.2% with none. "Not a guarantee, and it gives up some upside. That's the trade Alex asked for." | Optional: Replay → **Replay with your rules** (about 1 s). |
| 4:25 | 11 · How it works | "Gemini proposes, the engine disposes. No number comes from the LLM." | |
| 4:35 | 12 · Close | "Not more charts. More control, without more work. You set the rules; your fairy keeps you inside them. Thank you." | |

## If something breaks

- **Engine down:** stay in the slides. Slides 8 and 10 show real engine output, and slide 9 shows the real voice panel.
- **Sell-off is slow:** carry on with slide 7's lines while it plays; the trade usually lands within 20 s.
- **What-if is slow (no cache hit):** the AI agent is off or settings differ from the defaults. Turn the agent on, set live news off, and use the preset chip.

## Claims to keep straight

- Say "keeps you inside your limits" or "manages the risk of breaching them", never "guarantees". Overnight gaps can jump any line.
- Everything is paper trading on daily closes. It is not investment advice.
- The early-2025 numbers come from the engine's replay with simulated fills (README, "Results on real data").
