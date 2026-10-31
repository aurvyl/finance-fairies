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

## Run

```bash
cd engine
uv sync
uv run --project . pytest -q
uv run --project . python scripts/replay_demo.py
```

`replay_demo.py` prints the strategy comparison and writes `data/replay_result.json` (NAV per day, summary, event log) for the dashboard.

## Plugging in the agent

`replay(..., agent=fn)` calls `fn(context)` on every trigger. `context` holds the date, trigger reasons and values, current weights, the market window and the engine's own plan. Return target weights (`{ticker: weight}`) or `None`. The proposal goes through the same `check_plan` as the engine plan, and the lower-volatility passing plan wins.

## Defaults are heuristics

Thresholds come from research v1 and are not calibrated by backtest. The replay compares Guardian with buy-and-hold and a plain cash exit on the same data; report the result even when Guardian is not best.
