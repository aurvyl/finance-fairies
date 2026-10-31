# Guardian API: frontend integration

The Python engine computes every number; the frontend displays them and lets the user pick a provider.
LLM proposes, code disposes: any plan an LLM suggests is re-checked by the engine before it can trade.
All results are simulated (paper portfolio, daily closes).

## Run

```bash
cd engine
uv sync
bash scripts/set_gemini_key.sh          # once: stores GEMINI_API_KEY in engine/.env.local
uv run --project . uvicorn guardian.api:app --port 8000
```

CORS is open, so the Vite app can call `http://localhost:8000` directly. Interactive docs: `http://localhost:8000/docs`.

## Keys and providers

- Default provider: `gemini` (`gemini-4-argon`). Others: `openai`, `anthropic`, `openrouter`.
- Keys are read from `engine/.env.local` (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`).
- A settings screen may instead send a key per request in the `X-LLM-Key` header. It is used for that call only and never stored.
- `GET /providers` returns `[{id, label, default_model, features, key_configured, recommended}]` for a provider dropdown.

## Endpoints

| Endpoint | Body (all optional unless noted) | Returns | Typical latency |
|---|---|---|---|
| `GET /health` | | `{ok, simulated, datasets}` | instant |
| `GET /providers` | | provider list | instant |
| `POST /limits` | `{max_drawdown: 0.10, max_daily_loss: 0.02, holdings?}` | `thresholds` to draw the limit lines | instant |
| `POST /replay` | `{start, end, max_drawdown, max_daily_loss, mode, holdings?, candidates?, agent?}` | `nav` per strategy per day, `summary`, `events` | 1 s without agent; about 25 s per trigger with agent |
| `POST /analyze` | `{date: "2026-10-30", inject?, agent?, use_cache: true}` | `snapshot`, `plans`, `chosen`, `approval`, `agent` | 1 s without agent; 25-75 s with agent; instant when cached |
| `POST /news` | `{tickers?, date?}` | `{text, sources: [{url, title}], error}` (Google Search grounded) | about 15 s |
| `POST /ask` | `{question (required), context, provider?}` | `{answer, provider, model}` (same contract as the current `/api/ask`) | about 5 s |
| `POST /attribution` | `{date (required), holdings?}` | market vs stock-specific split of that day | instant |

Common fields:

- `holdings`: `{"NVDA": 0.3, "MSFT": 0.3, "BTC-USD": 0.1, ...}` (weights are normalised). Default: the 7-stock demo book. Crypto uses Yahoo `-USD` tickers.
- `mode`: `automatic` | `ask_first` | `paused` (maps to the three agent modes in the UI).
- `agent`: `{provider: "gemini", model?: null, live: false, thinking_level: "low", code_execution: false}`.
  `live: true` adds a Google-Search news brief; use it only for today's view, never in replays.
- `inject` (the "time machine"): `{"NVDA": -0.15}` replaces that day's move before the engine and agent decide.

### `/analyze` response (abridged)

```json
{
  "snapshot": {
    "date": "2026-10-30",
    "trigger": {"kind": "rotation", "reasons": ["Risk budget: 99% one-day VaR 3.3% > your 2% daily limit", "..."]},
    "shock": {"label": "broad-tech", "suggested_path": "HEDGE"},
    "attribution": {"portfolio_return": -0.038, "market_part": -0.035, "stock_specific_part": -0.003, "main_driver": "market", "unusual_moves": ["AMD"]},
    "portfolio": {"weights": {"NVDA": 0.1429}, "annual_vol": 0.225, "daily_var_99": 0.033}
  },
  "plans": [{"source": "engine", "passed": true, "actions": [{"type": "TRIM", "ticker": "AMD", "weight": 0.1}], "values": {"vol_after": 0.135}}],
  "chosen": "engine",
  "approval": "ask",
  "approval_reasons": ["ADD PG 15% of the portfolio is above the 10% auto limit"],
  "agent": {
    "provider": "gemini", "model": "gemini-4-argon", "decision": "ROTATE",
    "explanation": "Today's -3.8% portfolio drop was driven by a broad tech selloff ...",
    "key_factors": ["..."], "news_considered": ["..."], "sources": [{"url": "...", "title": "morningstar.com"}],
    "checks_run": 1, "tool_calls": ["get_risk_snapshot", "check_plan"], "error": null
  },
  "agent_agrees_with_engine": true,
  "cached": false
}
```

UI suggestions:

- Show `agent.explanation` as the "why" card and `agent.sources` as links; show `approval` as Auto / Ask you / Paused.
- `agent.tool_calls` and `checks_run` make the verification loop visible ("Gemini proposed, the engine checked it").
- Calls with an agent take tens of seconds: show progress, or keep `use_cache: true` (default) so a repeat of the same request is instant. Cached answers for the 2026-10-30 demo are committed under `engine/data/agent_cache/`.

## Moving the frontend from Claude to Gemini

`server/agentApi.ts` calls Claude directly. Point `/api/ask` at `POST http://localhost:8000/ask` with the same `{question, context}` body; the answer comes back as `{answer}`. Replace the synthetic `src/engine/sim.ts` data with `/replay` (NAV lines and events) and `/analyze` (today's decision).
