# Guardian engine

Deterministic risk engine, replay simulator, LLM agent and HTTP API for Portfolio Guardian. Every number the agent or the interface shows comes from this package: the LLM proposes, this code decides. All trades are simulated.

## Run

```bash
cd engine
uv sync
bash scripts/set_gemini_key.sh                       # once: GEMINI_API_KEY -> .env.local (git-ignored), then a test call
uv run --project . pytest -q                         # 18 tests, offline
uv run --project . uvicorn guardian.api:app --port 8000
uv run --project . python scripts/replay_demo.py     # optional: print the demo replay, write data/replay_result.json
```

Other providers: add `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` to `.env.local` (see `.env.local.example`), or send a key per request in the `X-LLM-Key` header.

## API

Full contract and response shapes: [API.md](API.md). Interactive docs at `http://localhost:8000/docs`.

| Endpoint | Purpose |
|---|---|
| `GET /providers` | Providers, default models, whether a key is configured (Gemini recommended) |
| `POST /limits` | `{max_drawdown, max_daily_loss}` -> the engine's thresholds |
| `POST /replay` | Hold vs cash exit vs Guardian over a period; `"agent": {"provider": "gemini"}` lets the LLM propose at each trigger |
| `POST /analyze` | One decision on one date; `"inject": {"NVDA": -0.12}` is the what-if shock; `"agent"` adds the LLM plan |
| `POST /news` | Google-Search-grounded news with source links (Gemini, live only) |
| `POST /ask` | Short spoken answer to a question about the portfolio |
| `POST /attribution` | Market vs stock-specific split of a day's move |

## How a decision is made

1. `triggers.evaluate` checks the daily close against the user's lines: rotation and emergency drawdown, 99% one-day VaR budget, shock day, volatility spike, cooldown.
2. `triggers.classify_shock` labels the day broad-tech, sector-led or mixed (suggests HEDGE or ROTATE).
3. `rotation.engine_plan` swaps 5% steps from the loss-driving and riskiest holdings into screened candidates (beta, volatility, crash correlation, liquidity), minimising variance until the volatility target and VaR budget are met.
4. `agent.GuardianAgent` (optional) gives the LLM four tools, `get_risk_snapshot`, `screen_candidates`, `check_plan`, `submit_plan`, and requires a passing `check_plan` before submitting.
5. `rotation.check_plan` re-tests every plan; `pick_best` keeps the lowest-volatility pass; `approval_route` returns auto, ask or blocked. If the agent advised HOLD on a passing engine plan, auto becomes ask.
6. `simulator.replay` fills at the next open with slippage and per-leg costs.

The user's two limits become the engine's lines in `config.policy_from_limits`: rotate at half the drawdown budget, emergency de-risk at 80% of it, a daily VaR budget and shock trigger equal to the daily limit.

## Layout

| Module | What it does |
|---|---|
| `guardian/config.py` | Policy defaults, demo universe, asset classes (equity, ETF, crypto), `policy_from_limits` |
| `guardian/data.py` | yfinance daily prices on the exchange calendar, cached to `data/*.parquet` |
| `guardian/metrics.py` | Returns, volatility, spike ratio, drawdown, beta, shrunk covariance, VaR, CVaR, turnover, cost |
| `guardian/triggers.py` | Triggers on each daily close and shock classification |
| `guardian/rotation.py` | Candidate screen, greedy rotation, `check_plan`, approval routing |
| `guardian/attribution.py` | CAPM split of a day's move; unusual-move z-scores; betas exclude the day being explained |
| `guardian/simulator.py` | Day-by-day replay of `hold`, `cash_exit` and `guardian` |
| `guardian/llm.py` | One tool-calling loop over Gemini (Interactions API), OpenAI, Anthropic and OpenRouter; grounded search |
| `guardian/agent.py` | `GuardianAgent`, decision context, news brief |
| `guardian/api.py` | FastAPI app |

## Assets

US stocks and ETFs, crypto as Yahoo `-USD` pairs (`BTC-USD`, `ETH-USD`), and bond or gold ETFs (`IEF`, `TLT`, `GLD`) as candidates. Crypto is aligned to exchange sessions (weekend moves land on Monday), capped at 10% per coin and shocked 45% in the tech-crash stress test.

## Gemini notes

- Default model `gemini-4-argon` with `thinking_level: "low"` and code execution off: about 25 s per decision instead of 77 s, because the engine already does the maths. Both are configurable per request.
- Live mode adds a Google-Search-grounded news brief (about 15 s) and cites its sources. Replays never search, so the agent cannot see the future.
- `/analyze` caches agent answers per request body in `data/agent_cache/`; the demo answers for 2026-10-30 (with and without live news) and the NVDA -15% what-if on 2026-10-29 are committed.

## Defaults are heuristics

Thresholds come from our research notes and are not calibrated by backtest. The replay compares Guardian with buy-and-hold and a plain cash exit on the same data; report the result even when Guardian is not best.
