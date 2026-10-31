# Guardian engine

Deterministic risk engine and replay simulator for Portfolio Guardian. Every number the agent or dashboard shows comes from this package; the LLM proposes, this code decides. All trades are SIMULATED.

## Layout

| Module | What it does |
|---|---|
| `guardian/config.py` | Policy defaults (research v1) and the demo universe |
| `guardian/data.py` | yfinance daily prices, cached to `data/*.parquet` |
| `guardian/metrics.py` | Returns, volatility, spike ratio, drawdown, beta, shrunk covariance, CVaR, turnover, cost |
| `guardian/triggers.py` | Emergency / rotation triggers on each daily close |
| `guardian/rotation.py` | Candidate screen, greedy 5% low-vol swaps, `check_plan` shared by engine and agent plans |
| `guardian/simulator.py` | Day-by-day replay; fills at next open with slippage; strategies `hold`, `cash_exit`, `guardian` |
| `guardian/attribution.py` | CAPM split of a day's move into market and stock-specific parts; unusual-move z-scores |
| `guardian/llm.py` | One tool-calling loop over Gemini (default), OpenAI, Anthropic and OpenRouter |
| `guardian/agent.py` | `GuardianAgent`: engine-backed tools, `check_plan` verification loop, `submit_plan` |
| `guardian/api.py` | FastAPI for the dashboard |

## Run

```bash
cd engine
uv sync
uv run --project . pytest -q
uv run --project . python scripts/replay_demo.py
```

`replay_demo.py` prints the strategy comparison and writes `data/replay_result.json` (NAV per day, summary, event log) for the dashboard.

## API

```bash
cp .env.local.example .env.local   # add GEMINI_API_KEY (or another provider's key)
uv run --project . uvicorn guardian.api:app --port 8000 --reload
```

| Endpoint | Purpose |
|---|---|
| `GET /providers` | Providers, default models, whether a key is configured (Gemini recommended) |
| `POST /limits` | `{max_drawdown, max_daily_loss}` -> engine thresholds for the UI |
| `POST /replay` | hold vs cash_exit vs guardian; add `"agent": {"provider": "gemini"}` to let the LLM propose at each trigger |
| `POST /analyze` | One decision on one date; `"inject": {"NVDA": -0.12}` is the what-if shock; `"agent"` adds the LLM plan |
| `POST /attribution` | Market vs stock-specific split for a date |

All bodies accept `holdings` (`{"NVDA": 0.3, "BTC-USD": 0.1, ...}`), `candidates`, `mode` (`automatic` / `ask_first` / `paused`). A key can also be sent per request in the `X-LLM-Key` header; it is used for that call only. `"live": true` lets Gemini use Google Search for news; replays never search.

Assets: US stocks and ETFs, plus crypto as Yahoo `-USD` pairs (`BTC-USD`, `ETH-USD`). Crypto is aligned to exchange sessions (weekend moves land on Monday), capped at 10% per coin and shocked 45% in the tech-crash stress test. Bond and gold ETFs (`IEF`, `TLT`, `GLD`) can be added as candidates.

## Plugging in the agent

`replay(..., agent=fn)` calls `fn(context)` on every trigger. `context` holds the date, trigger reasons and values, current weights, the market window and the engine's own plan. Return target weights (`{ticker: weight}`) or `None`. The proposal goes through the same `check_plan` as the engine plan, and the lower-volatility passing plan wins.

## Defaults are heuristics

Thresholds come from research v1 and are not calibrated by backtest. The replay compares Guardian with buy-and-hold and a plain cash exit on the same data; report the result even when Guardian is not best.
