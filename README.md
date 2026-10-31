# Finance Fairies — Autonomous AI Portfolio & Risk-Management Co-Pilot

Backend quantitative library (`quant_backend`), mathematical methodology, and real-world `yfinance` verification suite for the **Finance Fairies** Hackathon project.

---

## Folder Structure

```text
ai-portfolio-agent/
├── README.md                        # Overview, architecture, equations & quickstart
├── requirements.txt                 # Python dependencies (yfinance, pandas, numpy, fastapi)
├── test_real_world_data.py          # Live yfinance test script for all 5 applications
├── test_regression_suite.py         # 7-test mathematical & OLS regression suite
└── quant_backend/
    ├── __init__.py                  # Package exports (PortfolioQuantEngine, Holding, etc.)
    ├── models.py                    # Structured dataclasses with .to_dict() JSON export
    ├── engine.py                    # Core math & yfinance data engine
    └── api.py                       # Plug-and-play FastAPI server for Frontend UI
```

---

## Core Mathematical Applications Implemented

### 1. News-Reactive Dynamic Stop-Loss (`evaluate_dynamic_stop_loss`)
* **True Range ($\text{TR}_t$) & $n$-Period Average True Range ($\text{ATR}_n$):**
  $$\text{TR}_t = \max\bigl(H_t - L_t,\; |H_t - C_{t-1}|,\; |L_t - C_{t-1}|\bigr), \qquad \text{ATR}_n = \frac{1}{n}\sum_{i=1}^{n} \text{TR}_{t-i+1}$$
* **Net FinBERT Sentiment Score ($S_{\text{news}}$) & Multiplier ($M_{\text{news}}$):**
  $$S_{\text{news}} = P_+ - P_-, \qquad M_{\text{news}} = \max\bigl(m_{\min},\; 1 + S_{\text{news}}\bigr)$$
* **Dynamic Stop-Loss Price ($P_{\text{stop}}$):**
  $$P_{\text{stop}} = P_{\text{peak}} - \bigl(k \cdot \text{ATR}_n \cdot M_{\text{news}}\bigr)$$

### 2. "Sleep Soundly" Mode — Portfolio Beta Reduction (`calculate_sleep_soundly_rebalance`)
* **Asset Beta ($\beta_i$) & Total Portfolio Beta ($\beta_p$):**
  $$\beta_i = \frac{\text{Cov}(r_i, r_m)}{\text{Var}(r_m)}, \qquad w_i = \frac{V_i}{V_{\text{total}}}, \qquad \beta_p = \sum_{i=1}^{N} w_i \beta_i$$
* **Dollar Capital to Rotate from High-Beta Asset ($H$) to Safe-Haven Asset ($\beta_{rf} \approx 0$):**
  $$\Delta V_H = V_{\text{total}} \cdot \frac{\beta_p - \beta_{\text{target}}}{\beta_H - \beta_{rf}}$$

### 3. "Why Is My Portfolio Bleeding?" — Single-Index CAPM Attribution (`calculate_portfolio_attribution`)
* **Single-Asset & Total Portfolio Return Decomposition:**
  $$r_i = \beta_i r_m + \alpha_i, \qquad R_p = \sum_{i=1}^{N} w_i r_i = \underbrace{\left(\sum_{i=1}^{N} w_i \beta_i\right) r_m}_{\text{Macro / Market Component}} + \underbrace{\sum_{i=1}^{N} w_i \alpha_i}_{\text{Idiosyncratic Component}}$$

### 4. Quant Anomaly & Momentum Detection (`detect_anomalies_and_momentum`)
* **Rolling Volatility ($\sigma_i$) & Return Z-Score ($Z_{i,t}$):**
  $$\sigma_i = \sqrt{\frac{1}{n-1}\sum_{k=1}^{n} (r_{i,t-k+1} - \bar{r}_i)^2}, \qquad Z_{i,t} = \frac{r_{i,t} - \bar{r}_i}{\sigma_i}$$
* **$n$-Period Relative Strength Index ($\text{RSI}_n$):**
  $$\text{RS}_n = \frac{\frac{1}{n}\sum_{k=1}^{n} \max(0,\, \Delta P_{t-k+1})}{\frac{1}{n}\sum_{k=1}^{n} \max(0,\, -\Delta P_{t-k+1})}, \qquad \text{RSI}_n = 100 - \frac{100}{1 + \text{RS}_n}$$

### 5. "Hype-Check" Guardrail — Concentration & Parametric $\text{VaR}_{95}$ (`evaluate_hype_check_guardrail`)
* **Trade Concentration Ratio ($C_{\text{trade}}$) & 1-Day Value-at-Risk ($\text{VaR}_{\alpha}$):**
  $$C_{\text{trade}} = \frac{Q_{\text{trade}} \cdot P_i}{V_{\text{total}}}, \qquad \text{VaR}_{\alpha} = V_{\text{position}} \cdot z_{\alpha} \cdot \sigma_i$$

---

## Quickstart

### 1. Run Live `yfinance` Verification Suite
```bash
pip install -r requirements.txt
python test_real_world_data.py
```

### 2. Run Mathematical Regression Test Suite
```bash
python test_regression_suite.py
```

### 3. Start the FastAPI Server for Frontend Integration
```bash
uvicorn quant_backend.api:app --reload --port 8000
```

---

## Web interface

An agentic portfolio manager. You set rules for the **whole portfolio** in plain language ("don't let me lose more than 2% in a day", "don't let it fall more than 10% from its peak"), and the agent keeps hundreds of stocks, crypto assets and funds inside them automatically, then explains, by text or voice, why the market moved and why it acted.

The web interface (`src/`, `server/` at the repo root) has two halves. **Overview, Holdings, Activity and Guardrails** run on a built-in market and agent simulation (synthetic demo data), so the app works with nothing else running. **Replay and What-if** call the Guardian engine (`engine/`) over HTTP; without it, Replay shows a saved engine run and What-if explains how to connect.

![Overview](docs/overview.png)

A clickable build of the interface lives in [`design/artifact/`](design/artifact/index.html); open `index.html` from a local server (for example `npx serve design/artifact`).

### Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Press **Simulate a sell-off** to watch the agent respond, then open **Talk to your fairy**.

#### Connect the Guardian engine
```bash
cd engine && uv run --project . uvicorn guardian.api:app --port 8000
```

The interface looks for the engine at `http://localhost:8000`. Change it in **Settings**, or at build time with `VITE_ENGINE_URL=https://… npm run build`. Settings also turns on the engine's AI agent and picks its model provider; a provider key typed there is kept in memory for that tab only and sent as `X-LLM-Key`. The data layer lives in `src/api/` (`client.ts` for the calls, `types.ts` for the response shapes, `useEngine.ts` for connection state and request hooks).

#### Optional: Claude explanations
Open questions ("why is my portfolio down?") are answered by a built-in explainer that quotes the live numbers. To have Claude (Opus) answer them instead, start the dev server with an API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

The key stays on the server (`server/agentApi.ts`); the browser only sends the question and a numeric portfolio summary. Commands such as setting a rule or pausing the agent are always handled locally so they are instant and exact.

### What's in the interface
- **Guardrails as the hero.** Your daily loss limit and maximum drop are drawn on the chart as magenta load lines, with headroom meters beside it. Drag a limit and the chart updates before you save.
- **Automatic actions with reasons.** Each trade appears in Agent activity with the numbers behind it, an inline "Why", a "Listen" button that reads it aloud, and "Ask about this".
- **Three agent modes.** Automatic, Ask first (propose trades and wait for approval), and Paused.
- **Voice.** Hold the mic button (or hold Space) to talk; answers are spoken with the current word highlighted. Uses the browser's Web Speech API; works best in Chrome, Edge and Safari. Firefox falls back to typing with spoken answers.
- **Replay.** Runs your two rules over a past period on the engine and compares Guardian with buy and hold and selling everything: worst fall, days over the daily limit, return, trades and costs, with every limit check and its plans in a feed.
- **What-if.** Replace a day's moves (for example NVIDIA −12%) and see the trigger, the plans the engine checked, which passed, and whether it would trade on its own or ask you first.
- **Engine lines on Guardrails.** When connected, Guardrails lists the exact thresholds the engine derives from your rules.
- **Responsive.** Desktop rail becomes a bottom tab bar on phones.

### Code map
- `src/engine/sim.ts` market model and the agent's guardrail policy (swap for a real broker feed and decision service)
- `src/engine/ask.ts` question answering and rule parsing
- `src/voice.ts` speech recognition, mic level and speech synthesis
- `src/components/` chart, guardrails, activity feed, holdings, voice panel
- `DESIGN.md` design system; `PRODUCT.md` product brief
