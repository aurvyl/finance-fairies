"""HTTP API for the dashboard. Python computes every number; the frontend only displays.

Run (from engine/):
    uv run --project . uvicorn guardian.api:app --port 8000 --reload

LLM keys: put them in engine/.env.local, or send one per request in the X-LLM-Key header
(used for that call only, never stored or logged).
"""

from __future__ import annotations

import hashlib
import warnings

import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import GuardianAgent, build_context, jsonable, snapshot
from .attribution import attribute_day
from .config import ALL_TICKERS, BENCHMARK, REFERENCE, Policy, asset_class, policy_from_limits
from .data import fetch_prices
from .llm import provider_status
from .rotation import Plan, actions_between, approval_route, check_plan, pick_best
from .simulator import replay

warnings.filterwarnings("ignore")

app = FastAPI(title="Portfolio Guardian API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Cached datasets shipped for the demo (offline); anything else is downloaded once and cached.
DATASETS = {
    "replay_2025q1": ("2023-10-01", "2025-03-15"),
    "recent_2026": ("2025-08-01", "2026-11-01"),
}


class AgentConfig(BaseModel):
    provider: str = "gemini"
    model: str | None = None
    live: bool = False  # live mode lets Gemini use Google Search for news; replay never does


class PortfolioIn(BaseModel):
    max_drawdown: float = Field(0.10, gt=0, lt=1)
    max_daily_loss: float = Field(0.02, gt=0, lt=1)
    baseline: float = 10_000.0
    mode: str = Field("automatic", pattern="^(automatic|ask_first|paused)$")
    holdings: dict[str, float] | None = Field(None, description="ticker -> weight, e.g. {'NVDA': 0.3, 'BTC-USD': 0.1}; default demo book")
    candidates: list[str] | None = None


class ReplayIn(PortfolioIn):
    start: str = "2025-01-02"
    end: str = "2025-03-14"
    agent: AgentConfig | None = None


class AnalyzeIn(PortfolioIn):
    date: str = "2026-10-30"
    inject: dict[str, float] | None = Field(None, description="what-if shock: ticker -> that day's return, e.g. {'NVDA': -0.12}")
    agent: AgentConfig | None = None


def _policy(p: PortfolioIn) -> Policy:
    extra = {"agent_mode": p.mode}
    if p.holdings:
        extra["holdings"] = [t.upper() for t in p.holdings]
        extra["start_weights"] = {t.upper(): w for t, w in p.holdings.items()}
    if p.candidates:
        extra["candidates"] = [t.upper() for t in p.candidates]
    return policy_from_limits(p.max_drawdown, p.max_daily_loss, p.baseline, **extra)


def _frames(policy: Policy, start: str, end: str) -> dict[str, pd.DataFrame]:
    tickers = list(dict.fromkeys(policy.holdings + policy.candidates + [BENCHMARK] + REFERENCE))
    if set(tickers) <= set(ALL_TICKERS):
        for name, (a, b) in DATASETS.items():
            if a <= str(pd.Timestamp(start) - pd.Timedelta(days=120))[:10] and end <= b:
                return fetch_prices(a, b, cache_name=name)
    fetch_start = str((pd.Timestamp(start) - pd.Timedelta(days=400)).date())
    fetch_end = str((pd.Timestamp(end) + pd.Timedelta(days=2)).date())
    tag = hashlib.sha1(",".join(sorted(tickers)).encode()).hexdigest()[:8]
    try:
        return fetch_prices(fetch_start, fetch_end, tickers=tickers, cache_name=f"custom_{tag}_{fetch_start}_{fetch_end}")
    except Exception as exc:
        raise HTTPException(502, f"price download failed: {exc}") from exc


def _agent(cfg: AgentConfig | None, key: str | None) -> GuardianAgent | None:
    if cfg is None:
        return None
    return GuardianAgent(cfg.provider, cfg.model, api_key=key, live=cfg.live)


def _thresholds(policy: Policy) -> dict:
    return {"rotation_loss": policy.rotation_loss, "hwm_drawdown": policy.hwm_drawdown, "emergency_loss": policy.emergency_loss,
            "shock_day": policy.shock_portfolio_return, "daily_var_limit": policy.daily_var_limit, "rerisk_loss": policy.rerisk_loss,
            "auto_max_trade_weight": policy.auto_max_trade_weight}


@app.get("/health")
def health() -> dict:
    return {"ok": True, "simulated": True, "datasets": DATASETS}


@app.get("/providers")
def providers() -> dict:
    return {"default": "gemini", "providers": provider_status()}


@app.post("/limits")
def limits(p: PortfolioIn) -> dict:
    """Plain-language limits -> the engine's lines, so the UI can draw them."""
    policy = _policy(p)
    return {"limits": {"max_drawdown": p.max_drawdown, "max_daily_loss": p.max_daily_loss}, "thresholds": _thresholds(policy),
            "holdings": policy.initial_weights(), "asset_class": {t: asset_class(t) for t in policy.holdings}}


@app.post("/replay")
def run_replay(req: ReplayIn, x_llm_key: str | None = Header(None)) -> dict:
    """Day-by-day replay of hold vs cash-exit vs guardian; with `agent`, the LLM proposes at each trigger."""
    policy = _policy(req)
    frames = _frames(policy, req.start, req.end)
    missing = [t for t in policy.holdings + policy.candidates if t not in frames["close"].columns]
    if missing:
        raise HTTPException(400, f"no price data for {missing}")
    res = replay(frames, req.start, req.end, policy=policy, agent=_agent(req.agent, x_llm_key))
    return jsonable({
        "start": req.start, "end": req.end, "simulated": True,
        "limits": {"max_drawdown": req.max_drawdown, "max_daily_loss": req.max_daily_loss},
        "thresholds": _thresholds(policy),
        "nav": {k: {str(d.date()): round(float(v), 2) for d, v in s.items()} for k, s in res.nav.items()},
        "summary": res.summary().to_dict(orient="index"),
        "events": res.events,
    })


@app.post("/analyze")
def analyze(req: AnalyzeIn, x_llm_key: str | None = Header(None)) -> dict:
    """One decision on one date: engine numbers, engine plan, optional agent plan, both checked, approval route.
    `inject` turns it into the "time machine": replace that day's moves and see what Guardian would do."""
    policy = _policy(req)
    frames = _frames(policy, req.date, req.date)
    weights = pd.Series(policy.initial_weights())
    ctx = build_context(frames, req.date, weights, policy, req.inject)
    plans: list[Plan] = [ctx["engine_plan"]]
    agent_note = None
    agent = _agent(req.agent, x_llm_key)
    if agent is not None:
        out = agent.analyse(ctx)
        agent_note = out["note"]
        if out["weights"] is not None:
            w0, w1 = out["w0"], out["weights"]
            p = Plan("agent", w0, w1, actions_between(w0, w1))
            p.check = check_plan(w0, w1, ctx["window"], policy, ctx["max_steps"])  # code re-checks the agent's plan
            plans.append(p)
    best = pick_best(plans)
    route, why = approval_route(best, policy) if best else ("none", ["no plan passed the checks"])
    return jsonable({
        "snapshot": snapshot(ctx),
        "plans": [{"source": p.source, "passed": p.check.passed, "rejections": p.check.reasons, "values": p.check.values, "actions": p.actions} for p in plans],
        "chosen": best.source if best else None,
        "approval": route,
        "approval_reasons": why,
        "agent": agent_note,
        "simulated": True,
    })


class AttributionIn(BaseModel):
    date: str
    holdings: dict[str, float] | None = None


@app.post("/attribution")
def attribution(req: AttributionIn) -> dict:
    policy = _policy(PortfolioIn(holdings=req.holdings))
    frames = _frames(policy, req.date, req.date)
    r = frames["close"].loc[: req.date].pct_change().iloc[1:]
    return jsonable(attribute_day(r, pd.Series(policy.initial_weights())))

