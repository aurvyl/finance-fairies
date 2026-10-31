"""Day-by-day replay with local simulated fills (research v1, section 6).

Decisions use only data up to the decision close; orders fill at the next session's
open with slippage and per-leg cost. Three strategies run on the same data:
  hold       - buy and hold the starting portfolio
  cash_exit  - on the first trigger, sell everything to cash and stay out
  guardian   - engine (+ optional agent) rotation, emergency de-risk, slow re-risk
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from . import metrics as m
from .config import Policy
from .rotation import MarketWindow, Plan, actions_between, check_plan, engine_plan, pick_best
from .triggers import classify_shock, evaluate, recovery_ok

# An agent planner receives the decision context and may return target weights.
AgentPlanner = Callable[[dict], dict[str, float] | None]


@dataclass
class Book:
    shares: dict[str, float]
    cash: float

    def value(self, prices: pd.Series) -> float:
        return self.cash + sum(q * float(prices[t]) for t, q in self.shares.items() if q)

    def weights(self, prices: pd.Series) -> pd.Series:
        v = self.value(prices)
        return pd.Series({t: q * float(prices[t]) / v for t, q in self.shares.items() if q}, dtype=float)


@dataclass
class ReplayResult:
    nav: dict[str, pd.Series]
    events: list[dict] = field(default_factory=list)
    trades: dict[str, int] = field(default_factory=dict)
    costs: dict[str, float] = field(default_factory=dict)

    def summary(self) -> pd.DataFrame:
        rows = {}
        for name, nav in self.nav.items():
            rows[name] = {
                "final_value": float(nav.iloc[-1]),
                "total_return": float(nav.iloc[-1] / nav.iloc[0] - 1),
                "max_drawdown": float((1 - nav / nav.cummax()).max()),
                "trades": self.trades.get(name, 0),
                "costs": self.costs.get(name, 0.0),
            }
        return pd.DataFrame(rows).T


def _rebalance(book: Book, target_w: pd.Series, prices: pd.Series, policy: Policy) -> float:
    """Move the book to target weights at `prices`; returns costs paid. Sells first, then buys."""
    nav = book.value(prices)
    target_value = (target_w * nav).to_dict()
    cost = 0.0
    tickers = set(book.shares) | set(target_value)
    deltas = {t: target_value.get(t, 0.0) - book.shares.get(t, 0.0) * float(prices[t]) for t in tickers}
    for t, dv in sorted(deltas.items(), key=lambda kv: kv[1]):  # sells (negative) first
        if abs(dv) < 1e-6:
            continue
        px = float(prices[t]) * (1 - policy.slippage if dv < 0 else 1 + policy.slippage)
        qty = dv / px
        fee = abs(dv) * policy.cost_per_leg
        book.shares[t] = book.shares.get(t, 0.0) + qty
        book.cash -= qty * px + fee
        cost += fee + abs(qty) * abs(px - float(prices[t]))
    return cost


def replay(
    frames: dict[str, pd.DataFrame],
    start: str,
    end: str,
    policy: Policy | None = None,
    agent: AgentPlanner | None = None,
    on_event: Callable[[dict], None] | None = None,
) -> ReplayResult:
    policy = policy or Policy()
    close, open_, volume = frames["close"], frames["open"], frames["volume"]
    all_returns = close.pct_change()
    days = close.loc[start:end].index
    w_start = pd.Series({t: 1 / len(policy.holdings) for t in policy.holdings})

    books: dict[str, Book] = {}
    for name in ("hold", "cash_exit", "guardian"):
        p0 = close.loc[days[0]]
        books[name] = Book({t: policy.baseline * w / float(p0[t]) for t, w in w_start.items()}, 0.0)

    nav = {name: [] for name in books}
    trades = {name: 0 for name in books}
    costs = {name: 0.0 for name in books}
    events: list[dict] = []
    pending: dict[str, pd.Series | str] = {}
    cash_exit_done = False
    last_trade_i = -10**9
    recovery_streak = 0
    rotated = False

    def log(ev: dict) -> None:
        events.append(ev)
        if on_event:
            on_event(ev)

    for i, day in enumerate(days):
        # 1. Fill yesterday's decisions at today's open.
        for name, target in list(pending.items()):
            px = open_.loc[day]
            if isinstance(target, str) and target == "CASH":
                costs[name] += _rebalance(books[name], pd.Series(dtype=float), px, policy)
            else:
                costs[name] += _rebalance(books[name], target, px, policy)
            trades[name] += 1
            log({"date": str(day.date()), "strategy": name, "kind": "fill", "detail": "filled at open"})
        pending.clear()

        # 2. Mark to close.
        px_close = close.loc[day]
        for name, book in books.items():
            nav[name].append(book.value(px_close))
        if i < 1:
            continue

        g_nav = pd.Series(nav["guardian"], index=days[: i + 1])
        r_hist = all_returns.loc[:day].iloc[1:]
        prev_px = close.loc[days[i - 1]]
        w_prev = books["guardian"].weights(prev_px)

        # 3. Cash-exit benchmark: leave the market on its first trigger.
        if not cash_exit_done:
            c_nav = pd.Series(nav["cash_exit"], index=days[: i + 1])
            c_trig = evaluate(c_nav, r_hist, books["cash_exit"].weights(prev_px), policy)
            if c_trig.kind:
                pending["cash_exit"] = "CASH"
                cash_exit_done = True
                log({"date": str(day.date()), "strategy": "cash_exit", "kind": "exit", "reasons": c_trig.reasons})

        # 4. Guardian.
        trig = evaluate(g_nav, r_hist, w_prev, policy)
        window = MarketWindow(returns=r_hist, close=close.loc[:day], volume=volume.loc[:day])
        if trig.kind == "emergency":
            pending["guardian"] = "CASH"
            last_trade_i = i
            log({"date": str(day.date()), "strategy": "guardian", "kind": "emergency", "reasons": trig.reasons, "values": trig.values})
            continue

        if trig.kind == "rotation" and i - last_trade_i > policy.cooldown_sessions:
            w_now = books["guardian"].weights(px_close)
            shock = classify_shock(r_hist, w_prev)
            plans: list[Plan] = [engine_plan(w_now, window, policy)]
            if agent is not None:
                ctx = {"date": str(day.date()), "trigger": trig, "shock": shock, "weights": w_now, "window": window, "policy": policy, "engine_plan": plans[0]}
                proposal = agent(ctx)
                if proposal:
                    universe = list(dict.fromkeys(list(w_now.index) + policy.candidates))
                    w0 = w_now.reindex(universe).fillna(0.0)
                    w1 = pd.Series(proposal, dtype=float).reindex(universe).fillna(0.0)
                    agent_plan = Plan("agent", w0, w1, actions_between(w0, w1))
                    agent_plan.check = check_plan(w0, w1, window, policy)
                    plans.append(agent_plan)
            best = pick_best(plans)
            log({
                "date": str(day.date()),
                "strategy": "guardian",
                "kind": "trigger",
                "reasons": trig.reasons,
                "values": trig.values,
                "shock": shock,
                "plans": [
                    {"source": p.source, "passed": p.check.passed, "rejections": p.check.reasons, "values": p.check.values, "actions": p.actions}
                    for p in plans
                ],
                "chosen": best.source if best else None,
            })
            if best is not None:
                pending["guardian"] = best.weights_after[best.weights_after > 1e-9]
                last_trade_i = i
                rotated = True
                recovery_streak = 0
            continue

        # 5. Slow re-risk back toward the starting holdings.
        if rotated and i - last_trade_i >= policy.rerisk_min_sessions:
            recovery_streak = recovery_streak + 1 if recovery_ok(g_nav, policy) else 0
            if recovery_streak >= policy.rerisk_confirm_closes:
                w_now = books["guardian"].weights(px_close)
                defensive = w_now[[t for t in w_now.index if t in policy.candidates]]
                if defensive.sum() > 1e-6:
                    move = min(policy.step, float(defensive.sum()))
                    w_new = w_now.copy()
                    w_new[defensive.index] -= defensive / defensive.sum() * move
                    for t, w in w_start.items():
                        w_new[t] = w_new.get(t, 0.0) + w * move
                    pending["guardian"] = w_new[w_new > 1e-9]
                    last_trade_i = i
                    recovery_streak = 0
                    log({"date": str(day.date()), "strategy": "guardian", "kind": "re-risk", "detail": f"moved {move:.0%} back to the original holdings"})

    nav_series = {name: pd.Series(v, index=days) for name, v in nav.items()}
    return ReplayResult(nav=nav_series, events=events, trades=trades, costs=costs)
