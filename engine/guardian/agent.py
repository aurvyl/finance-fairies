"""The LLM agent: reads engine numbers through tools, proposes a plan, verifies it, explains it.

LLM proposes, code disposes. The agent can only see numbers our code computed, must run
`check_plan` (the same acceptance test the engine uses) before submitting, and its plan is
checked again by the simulator or API before anything trades.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import metrics as m
from .attribution import attribute_day
from .config import Policy, asset_class, sector_of
from .llm import AgentRun, Tool, gemini_grounded, run_agent
from .rotation import MarketWindow, Plan, actions_between, approval_route, check_plan, engine_plan, loss_ranking, screen_candidates
from .triggers import classify_shock, evaluate

WEIGHTS_SCHEMA = {
    "type": "array",
    "description": "Full target portfolio after the trade, one entry per position; weights are fractions of NAV and sum to 1.",
    "items": {
        "type": "object",
        "properties": {"ticker": {"type": "string"}, "weight": {"type": "number"}},
        "required": ["ticker", "weight"],
    },
}

SYSTEM = """You are Portfolio Guardian, a risk agent for a retail investor's paper portfolio.
The user set two limits: a maximum drawdown and a maximum one-day loss. Your job is to keep the
portfolio inside them by ROTATING risk (moving weight from the riskiest holdings into screened,
lower-volatility candidates), not by selling everything to cash.

Rules:
- Every number you state must come from a tool result. Do not invent prices, returns or risk figures.
- Only use tickers that appear in get_risk_snapshot (holdings or candidates).
- Before submitting, call check_plan on your proposal. If it fails, read the reasons, adjust and check
  again (at most 3 attempts). If nothing passes, submit decision HOLD and say why.
- Move in 5% steps. Prefer the smallest change that meets the volatility and daily-VaR targets.
- Finish by calling submit_plan exactly once. The explanation is for a non-expert: under 120 words,
  plain English, name the main driver of today's move and what the trade changes in numbers.
{news_rule}"""

NEWS_LIVE = """- Live mode: the prompt includes a news brief from Google Search (earnings, guidance, export rules,
  regulation, insider sales, political or Congress actions). News is context only: it can change which
  holdings you trim first, never the risk checks. List the headlines you used in news_considered."""

NEWS_PROMPT = """You are a markets news desk. As of {date}, find the news from the last 48 hours that explains the
moves in these tickers: {movers}. Cover company news (earnings, guidance), sector news, regulation or export
rules, insider selling, and political or US Congress actions where relevant. Answer in at most 6 bullet
points, one headline each with source name and date. If you find nothing reliable for a ticker, say so."""


def news_brief(tickers: list[str], date: str, api_key: str | None = None) -> dict:
    """Grounded news for the given tickers (live mode only: it searches today's web)."""
    return gemini_grounded(NEWS_PROMPT.format(date=date, movers=", ".join(tickers)), api_key=api_key)
NEWS_REPLAY = """- Historical replay as of {date}: do not search the web and do not use knowledge of what happened after
  {date}. Leave news_considered empty."""


def _f(x):
    """JSON-friendly scalar."""
    if isinstance(x, (np.floating, float)):
        return None if not np.isfinite(x) else round(float(x), 6)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def jsonable(obj):
    return json.loads(json.dumps(obj, default=lambda o: _f(o) if isinstance(o, (np.generic,)) else str(o)))


def _weights_from_list(items: list[dict], universe: list[str]) -> pd.Series:
    s = pd.Series({str(i["ticker"]).upper(): float(i["weight"]) for i in items}, dtype=float)
    unknown = [t for t in s.index if t not in universe]
    if unknown:
        raise ValueError(f"tickers outside the allowed universe: {unknown}")
    s = s.reindex(universe).fillna(0.0).clip(lower=0.0)
    return s / s.sum() if s.sum() > 0 else s


def build_context(frames: dict[str, pd.DataFrame], day: str, weights: pd.Series, policy: Policy,
                  inject: dict[str, float] | None = None, lookback: int = 60) -> dict:
    """Decision context for one date from data up to that close. `inject` overrides that day's
    returns per ticker (the "what if" shock), e.g. {"NVDA": -0.12}.

    NAV is the current weights held over the last `lookback` sessions, so drawdowns are measured
    against the value `lookback` sessions ago (an approximation outside a full replay).
    """
    close = frames["close"].loc[:day].copy()
    volume = frames["volume"].loc[:day]
    ts = close.index[-1]
    if inject:
        prev = close.iloc[-2]
        for t, r in inject.items():
            close.loc[ts, t] = float(prev[t]) * (1 + float(r))
    returns = close.pct_change().iloc[1:]
    window = MarketWindow(returns=returns, close=close, volume=volume)
    held = weights[weights > 0]
    port_r = (returns[held.index].iloc[-lookback:] * held).sum(axis=1)
    nav = policy.baseline * (1 + port_r).cumprod()
    trig = evaluate(nav, returns, held, policy)
    steps = policy.max_steps_budget if trig.budget_breach else policy.max_steps
    return {
        "date": str(ts.date()),
        "trigger": trig,
        "shock": classify_shock(returns, held),
        "weights": held,
        "window": window,
        "policy": policy,
        "engine_plan": engine_plan(held, window, policy, steps),
        "max_steps": steps,
        "nav": nav,
        "injected": inject or {},
    }


def snapshot(ctx: dict) -> dict:
    """Everything the agent (and the UI) needs to know about today, computed by code."""
    policy: Policy = ctx["policy"]
    w: pd.Series = ctx["weights"]
    window: MarketWindow = ctx["window"]
    trig = ctx["trigger"]
    names = list(w.index)
    cov = m.shrunk_cov(window.returns[names].iloc[-policy.cov_window:], policy.cov_shrink)
    eng: Plan = ctx["engine_plan"]
    return jsonable({
        "date": ctx["date"],
        "limits": {"daily_var_limit": policy.daily_var_limit, "rotation_loss": policy.rotation_loss,
                   "emergency_loss": policy.emergency_loss, "target_annual_vol": policy.target_annual_vol},
        "trigger": {"kind": trig.kind, "reasons": trig.reasons, "values": trig.values, "budget_breach": trig.budget_breach},
        "shock": ctx["shock"],
        "attribution": attribute_day(window.returns, w),
        "portfolio": {
            "weights": {t: float(v) for t, v in w.items()},
            "asset_class": {t: asset_class(t) for t in names},
            "sector": {t: sector_of(t) for t in names},
            "annual_vol": m.portfolio_vol(w, cov),
            "daily_var_99": m.daily_var(w, cov, policy.var_z),
            "last_5d_return": {t: float((1 + window.returns[t].iloc[-5:]).prod() - 1) for t in names},
        },
        "candidates": policy.candidates,
        "engine_plan": {"actions": eng.actions, "passed": eng.check.passed, "rejections": eng.check.reasons, "values": eng.check.values},
        "injected_shock": ctx.get("injected", {}),
        "caps": {"stock": policy.cap_stock, "etf": policy.cap_etf, "crypto_per_coin": policy.cap_crypto, "sector": policy.cap_sector},
    })


def make_tools(ctx: dict) -> tuple[list[Tool], dict]:
    policy: Policy = ctx["policy"]
    window: MarketWindow = ctx["window"]
    w0_held: pd.Series = ctx["weights"]
    universe = list(dict.fromkeys(list(w0_held.index) + policy.candidates))
    w0 = w0_held.reindex(universe).fillna(0.0)
    state: dict = {"checks": 0}

    def tool_snapshot(_: dict) -> dict:
        return snapshot(ctx)

    def tool_screen(args: dict) -> dict:
        replaced = str(args.get("replace", "")).upper()
        if replaced not in w0_held.index:
            return {"error": f"{replaced} is not a holding"}
        basket = loss_ranking(w0_held, window.returns[w0_held.index])[:3]
        return jsonable({"replace": replaced, "crash_basket": basket, "passed": screen_candidates(window, replaced, basket, policy)})

    def tool_check(args: dict) -> dict:
        state["checks"] += 1
        w1 = _weights_from_list(args["target_weights"], universe)
        chk = check_plan(w0, w1, window, policy, ctx.get("max_steps"))
        plan = Plan("agent", w0, w1, actions_between(w0, w1), chk)
        route, why = approval_route(plan, policy)
        return jsonable({"passed": chk.passed, "rejections": chk.reasons, "values": chk.values, "actions": plan.actions,
                         "approval": route, "approval_reasons": why})

    tools = [
        Tool("get_risk_snapshot", "Today's trigger, shock type, CAPM attribution, portfolio risk, limits and the engine's own plan.",
             {"type": "object", "properties": {}}, tool_snapshot),
        Tool("screen_candidates", "Candidates that pass beta, volatility, crash-correlation and liquidity screens versus one holding.",
             {"type": "object", "properties": {"replace": {"type": "string", "description": "holding to reduce"}}, "required": ["replace"]}, tool_screen),
        Tool("check_plan", "Run the deterministic acceptance test (vol, CVaR, stress, caps, turnover, cost, VaR) on a full target portfolio.",
             {"type": "object", "properties": {"target_weights": WEIGHTS_SCHEMA}, "required": ["target_weights"]}, tool_check),
        Tool("submit_plan", "Submit the final decision. Call once, after check_plan.",
             {"type": "object", "properties": {
                 "decision": {"type": "string", "enum": ["ROTATE", "HOLD", "HEDGE_REQUEST"]},
                 "target_weights": WEIGHTS_SCHEMA,
                 "explanation": {"type": "string"},
                 "key_factors": {"type": "array", "items": {"type": "string"}},
                 "news_considered": {"type": "array", "items": {"type": "string"}},
             }, "required": ["decision", "target_weights", "explanation", "key_factors"]}),
    ]
    return tools, {"universe": universe, "w0": w0, "state": state}


def escalate_on_disagreement(route: str, reasons: list[str], note: dict | None, chosen: str | None) -> tuple[str, list[str]]:
    """The agent cannot veto a passing engine plan, but if it advised HOLD, a human decides instead of auto."""
    if route == "auto" and chosen == "engine" and note and note.get("decision") == "HOLD":
        why = (note.get("key_factors") or [note.get("explanation") or ""])[0]
        return "ask", reasons + [f"the AI agent recommended holding: {str(why)[:160]}"]
    return route, reasons


class GuardianAgent:
    """AgentPlanner for the simulator and the API. Provider is user-selectable; Gemini is the default."""

    def __init__(self, provider: str = "gemini", model: str | None = None, api_key: str | None = None,
                 live: bool = False, code_execution: bool = True, thinking_level: str | None = "low"):
        self.provider, self.model, self.api_key = provider, model, api_key
        self.live, self.code_execution, self.thinking_level = live, code_execution, thinking_level
        self.runs: list[AgentRun] = []

    def analyse(self, ctx: dict) -> dict:
        tools, aux = make_tools(ctx)
        news_rule = NEWS_LIVE if self.live else NEWS_REPLAY.format(date=ctx["date"])
        prompt = (f"Decision date {ctx['date']}. The engine flagged: {ctx['trigger'].reasons or ['no trigger']}. "
                  "Start with get_risk_snapshot, decide, verify with check_plan, then submit_plan.")
        news = None
        if self.live:
            r = ctx["window"].returns.iloc[-1].reindex(ctx["weights"].index)
            movers = list(r.abs().sort_values(ascending=False).index[:4])
            news = news_brief(movers, ctx["date"], self.api_key if self.provider == "gemini" else None)
            if news["text"]:
                prompt += "\n\nNews brief (Google Search, cite these headlines only):\n" + news["text"]
        run = run_agent(self.provider, SYSTEM.format(news_rule=news_rule), prompt, tools, "submit_plan",
                        model=self.model, api_key=self.api_key, code_execution=self.code_execution,
                        web_search=False, thinking_level=self.thinking_level)
        self.runs.append(run)
        note = {"provider": run.provider, "model": run.model, "error": run.error, "checks_run": aux["state"]["checks"],
                "tool_calls": [t["tool"] for t in run.trace],
                "sources": (news or {}).get("sources", [])[:8] or run.sources[:8],
                "news_brief": (news or {}).get("text"), "news_error": (news or {}).get("error")}
        weights = None
        if run.final:
            note.update({k: run.final.get(k) for k in ("decision", "explanation", "key_factors", "news_considered")})
            if run.final.get("decision") == "ROTATE" and run.final.get("target_weights"):
                try:
                    weights = _weights_from_list(run.final["target_weights"], aux["universe"])
                except ValueError as exc:
                    note["error"] = str(exc)
        elif not run.error:
            note["error"] = "model finished without calling submit_plan"
            note["explanation"] = run.text
        return {"note": jsonable(note), "weights": weights, "w0": aux["w0"]}

    def __call__(self, ctx: dict) -> dict[str, float] | None:
        out = self.analyse(ctx)
        ctx["agent_note"] = out["note"]
        w = out["weights"]
        return None if w is None else {t: float(v) for t, v in w[w > 1e-9].items()}
