# Finance Fairies

An agentic portfolio manager. You set rules for the **whole portfolio** in plain language ("don't let me lose more than 2% in a day", "don't let it fall more than 10% from its peak"), and the agent keeps hundreds of stocks, crypto assets and funds inside them automatically, then explains, by text or voice, why the market moved and why it acted.

This repository holds the web interface, running on a built-in market and agent simulation (synthetic demo data).

![Overview](docs/overview.png)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Press **Simulate a sell-off** to watch the agent respond, then open **Talk to your fairy**.

### Optional: Claude explanations
Open questions ("why is my portfolio down?") are answered by a built-in explainer that quotes the live numbers. To have Claude (Opus) answer them instead, start the dev server with an API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

The key stays on the server (`server/agentApi.ts`); the browser only sends the question and a numeric portfolio summary. Commands such as setting a rule or pausing the agent are always handled locally so they are instant and exact.

## What's in the interface
- **Guardrails as the hero.** Your daily loss limit and maximum drop are drawn on the chart as magenta load lines, with headroom meters beside it. Drag a limit and the chart updates before you save.
- **Automatic actions with reasons.** Each trade appears in Agent activity with the numbers behind it, an inline "Why", a "Listen" button that reads it aloud, and "Ask about this".
- **Three agent modes.** Automatic, Ask first (propose trades and wait for approval), and Paused.
- **Voice.** Hold the mic button (or hold Space) to talk; answers are spoken with the current word highlighted. Uses the browser's Web Speech API; works best in Chrome, Edge and Safari. Firefox falls back to typing with spoken answers.
- **Responsive.** Desktop rail becomes a bottom tab bar on phones.

## Code map
- `src/engine/sim.ts` market model and the agent's guardrail policy (swap for a real broker feed and decision service)
- `src/engine/ask.ts` question answering and rule parsing
- `src/voice.ts` speech recognition, mic level and speech synthesis
- `src/components/` chart, guardrails, activity feed, holdings, voice panel
- `DESIGN.md` design system; `PRODUCT.md` product brief
