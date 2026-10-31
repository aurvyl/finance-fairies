"""Candidate screen, greedy low-volatility rotation and the plan checks (research v1, section 3).

The same `check_plan` judges the engine's own plan and any plan proposed by the agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import metrics as m
from .config import BENCHMARK, ETFS, SECTOR, TECH_SECTORS, Policy


@dataclass
class MarketWindow:
    """Data available at the decision close (no look-ahead)."""

    returns: pd.DataFrame  # daily returns up to today, all tickers
    close: pd.DataFrame
    volume: pd.DataFrame


@dataclass
class PlanCheck:
    passed: bool
    reasons: list[str]
    values: dict[str, float]


@dataclass
class Plan:
    source: str  # "engine" | "agent"
    weights_before: pd.Series
    weights_after: pd.Series
    actions: list[dict] = field(default_factory=list)
    check: PlanCheck | None = None


def loss_ranking(weights: pd.Series, r: pd.DataFrame, days: int = 5) -> list[str]:
    """Holdings ordered by their loss contribution over the last `days` sessions (worst first)."""
    cum = (1 + r.iloc[-days:]).prod() - 1
    contrib = (weights * cum.reindex(weights.index)).dropna()
    contrib = contrib[(weights.reindex(contrib.index) > 0) & (contrib < 0)]
    return list(contrib.sort_values().index)


def screen_candidates(
    window: MarketWindow, replaced: str, crash_basket: list[str], policy: Policy
) -> dict[str, dict]:
    """Return {ticker: screen values} for candidates that pass every screen versus `replaced`."""
    r = window.returns.iloc[-policy.cov_window:]
    basket = r[crash_basket].mean(axis=1) if crash_basket else r[BENCHMARK]
    vol_replaced = float(r[replaced].std(ddof=1))
    passed: dict[str, dict] = {}
    for c in policy.candidates:
        hist = window.returns[c].dropna()
        if len(hist) < policy.min_history:
            continue
        b = m.beta(r[c], r[BENCHMARK])
        vol = float(r[c].std(ddof=1))
        corr = float(r[c].corr(basket))
        adv = m.adv_usd(window.close[c], window.volume[c])
        ok = b <= policy.max_beta and vol <= policy.max_vol_ratio * vol_replaced and corr <= policy.max_crash_corr and adv >= policy.min_adv_usd
        if ok:
            passed[c] = {"beta": b, "vol_ratio": vol / max(vol_replaced, m.EPS), "crash_corr": corr, "adv_usd": adv}
    return passed


def caps_ok(w_new: pd.Series, w_old: pd.Series, policy: Policy) -> tuple[bool, list[str]]:
    """Position and sector caps. A cap already breached before trading may shrink but never grow."""
    problems: list[str] = []
    for t, w in w_new.items():
        cap = policy.cap_etf if t in ETFS else policy.cap_stock
        old = float(w_old.get(t, 0.0))
        if w > cap + 1e-9 and w > old + 1e-9:
            problems.append(f"{t} weight {w:.1%} above cap {cap:.0%}")
    sec_new = w_new.groupby(lambda t: SECTOR.get(t, "other")).sum()
    sec_old = w_old.groupby(lambda t: SECTOR.get(t, "other")).sum()
    for s, w in sec_new.items():
        old = float(sec_old.get(s, 0.0))
        if w > policy.cap_sector + 1e-9 and w > old + 1e-9:
            problems.append(f"sector {s} weight {w:.1%} above cap {policy.cap_sector:.0%}")
    return (not problems), problems


def stress_loss(w: pd.Series, scenario: str) -> float:
    """Loss (positive fraction) under a hypothetical scenario; not a forecast."""
    if scenario == "equities_down_20":
        return float(w.sum() * 0.20)
    if scenario == "tech_down_30_defensive_down_15":
        shock = pd.Series({t: (0.30 if SECTOR.get(t) in TECH_SECTORS else 0.15) for t in w.index})
        return float((w * shock).sum())
    raise ValueError(scenario)


STRESS_SCENARIOS = ["equities_down_20", "tech_down_30_defensive_down_15"]


def check_plan(w_old: pd.Series, w_new: pd.Series, window: MarketWindow, policy: Policy) -> PlanCheck:
    """Deterministic acceptance test shared by engine and agent plans."""
    universe = w_old.index.union(w_new.index)
    w_old = w_old.reindex(universe).fillna(0.0)
    w_new = w_new.reindex(universe).fillna(0.0)
    reasons: list[str] = []

    if (w_new < -1e-9).any():
        reasons.append("negative weight (no shorting)")
    if abs(w_new.sum() - w_old.sum()) > 1e-6:
        reasons.append("plan changes total invested weight")

    r_cov = window.returns[universe].iloc[-policy.cov_window:]
    cov = m.shrunk_cov(r_cov, policy.cov_shrink)
    vol0, vol1 = m.portfolio_vol(w_old, cov), m.portfolio_vol(w_new, cov)
    r_cvar = window.returns[universe].iloc[-policy.cvar_window:]
    cvar0 = m.historical_cvar(w_old, r_cvar, policy.cvar_alpha)
    cvar1 = m.historical_cvar(w_new, r_cvar, policy.cvar_alpha)
    cost = m.trade_cost(w_new, w_old, policy.cost_per_leg)
    turn = m.turnover(w_new, w_old)
    reduction = 1 - vol1 / max(vol0, m.EPS)

    if reduction < policy.min_vol_reduction:
        reasons.append(f"volatility falls only {reduction:.1%} (< {policy.min_vol_reduction:.0%})")
    if cvar1 + cost > cvar0 + 1e-12:
        reasons.append(f"CVaR + cost {cvar1 + cost:.2%} worse than now {cvar0:.2%}")
    if cost > policy.max_cost_nav + 1e-12:
        reasons.append(f"cost {cost:.2%} of NAV above limit {policy.max_cost_nav:.2%}")
    if turn > policy.step * policy.max_steps + 1e-9:
        reasons.append(f"turnover {turn:.1%} above limit {policy.step * policy.max_steps:.0%}")
    stress = {}
    for s in STRESS_SCENARIOS:
        before, after = stress_loss(w_old, s), stress_loss(w_new, s)
        stress[s] = after
        if after > before + 1e-9:
            reasons.append(f"stress '{s}' loss {after:.1%} worse than {before:.1%}")
    ok, cap_problems = caps_ok(w_new, w_old, policy)
    reasons.extend(cap_problems)

    values = {
        "vol_before": vol0,
        "vol_after": vol1,
        "vol_reduction": reduction,
        "cvar_before": cvar0,
        "cvar_after": cvar1,
        "cost_nav": cost,
        "turnover": turn,
        **{f"stress_{k}": v for k, v in stress.items()},
    }
    return PlanCheck(passed=not reasons, reasons=reasons, values=values)


def actions_between(w_old: pd.Series, w_new: pd.Series) -> list[dict]:
    """Describe a weight change as typed actions (TRIM / ADD) for the UI and the audit log."""
    idx = w_old.index.union(w_new.index)
    d = (w_new.reindex(idx).fillna(0) - w_old.reindex(idx).fillna(0)).round(6)
    acts = [{"type": "TRIM", "ticker": t, "weight": float(-v)} for t, v in d.items() if v < 0]
    acts += [{"type": "ADD", "ticker": t, "weight": float(v)} for t, v in d.items() if v > 0]
    return acts


def engine_plan(weights: pd.Series, window: MarketWindow, policy: Policy) -> Plan:
    """Greedy 5% swaps from the loss-driving holdings into screened candidates, minimising variance."""
    universe = list(dict.fromkeys(list(weights.index) + policy.candidates))
    w0 = weights.reindex(universe).fillna(0.0)
    r = window.returns[universe].iloc[-policy.cov_window:]
    cov = m.shrunk_cov(r, policy.cov_shrink)
    vol0 = m.portfolio_vol(w0, cov)

    held = w0[w0 > 0].index
    losers = [t for t in loss_ranking(w0[held], window.returns[held]) if t in policy.holdings]
    crash_basket = losers[:3]
    screens = {t: screen_candidates(window, t, crash_basket, policy) for t in losers[:3]}

    proposal = w0.copy()
    for _ in range(policy.max_steps):
        best, best_vol = None, m.portfolio_vol(proposal, cov)
        for loser in losers[:3]:
            if proposal[loser] < policy.step - 1e-9:
                continue
            for cand in screens.get(loser, {}):
                trial = proposal.copy()
                trial[loser] -= policy.step
                trial[cand] += policy.step
                if not caps_ok(trial, w0, policy)[0]:
                    continue
                v = m.portfolio_vol(trial, cov)
                if v < best_vol - 1e-12:
                    best, best_vol = trial, v
        if best is None:
            break
        proposal = best
        if best_vol <= min(policy.target_annual_vol, (1 - policy.min_vol_reduction) * vol0):
            break

    plan = Plan("engine", w0, proposal, actions_between(w0, proposal))
    plan.check = check_plan(w0, proposal, window, policy)
    return plan


def pick_best(plans: list[Plan]) -> Plan | None:
    """Among plans that passed, take the one with the lowest post-trade volatility."""
    passing = [p for p in plans if p.check and p.check.passed]
    if not passing:
        return None
    return min(passing, key=lambda p: (p.check.values["vol_after"], p.check.values["cost_nav"]))


def weights_from_dict(d: dict[str, float], universe: list[str]) -> pd.Series:
    s = pd.Series(d, dtype=float).reindex(universe).fillna(0.0)
    return s.clip(lower=0.0) if np.isfinite(s).all() else s
