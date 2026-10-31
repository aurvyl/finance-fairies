"""Zone and trigger detection on a daily close (research v1, section 2)."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import metrics as m
from .config import Policy


@dataclass
class TriggerResult:
    kind: str | None  # "emergency" | "rotation" | None
    reasons: list[str] = field(default_factory=list)
    values: dict[str, float] = field(default_factory=dict)


def evaluate(
    nav: pd.Series,
    asset_returns: pd.DataFrame,
    weights_prev: pd.Series,
    policy: Policy,
) -> TriggerResult:
    """Decide whether today's close calls for action.

    nav: portfolio value up to and including today.
    asset_returns: daily returns up to and including today.
    weights_prev: weights held over today's return (start-of-day weights).
    """
    baseline_loss, hwm_dd = m.drawdowns(nav, policy.baseline)
    port_r = nav.pct_change().dropna()
    day_r = float(port_r.iloc[-1]) if len(port_r) else 0.0
    ratio = m.spike_ratio(port_r)
    short_vol = float(m.realised_vol(port_r, 5, annualise=True)) if len(port_r) >= 5 else float("nan")

    values = {
        "baseline_loss": baseline_loss,
        "hwm_drawdown": hwm_dd,
        "portfolio_day_return": day_r,
        "spike_ratio": ratio,
        "short_annual_vol": short_vol,
    }

    if baseline_loss >= policy.emergency_loss:
        return TriggerResult("emergency", [f"Loss vs baseline {baseline_loss:.1%} ≥ {policy.emergency_loss:.0%}"], values)

    reasons: list[str] = []
    if baseline_loss >= policy.rotation_loss:
        reasons.append(f"Loss vs baseline {baseline_loss:.1%} ≥ {policy.rotation_loss:.0%}")
    if hwm_dd >= policy.hwm_drawdown:
        reasons.append(f"Drawdown from peak {hwm_dd:.1%} ≥ {policy.hwm_drawdown:.0%}")
    if day_r <= policy.shock_portfolio_return:
        reasons.append(f"Portfolio day return {day_r:.1%} ≤ {policy.shock_portfolio_return:.0%}")

    today = asset_returns.iloc[-1]
    for t, w in weights_prev.items():
        if w <= 0 or t not in today.index or pd.isna(today[t]):
            continue
        contrib = w * today[t]
        if today[t] <= policy.shock_holding_return and contrib <= -policy.shock_holding_contribution:
            reasons.append(f"{t} {today[t]:.1%} today, costing the portfolio {-contrib:.1%}")

    if ratio == ratio and ratio >= policy.spike_ratio and short_vol >= policy.spike_min_annual_vol:
        reasons.append(f"Volatility spike: 5d/60d = {ratio:.2f}, short-window vol {short_vol:.0%}")

    return TriggerResult("rotation" if reasons else None, reasons, values)


def recovery_ok(nav: pd.Series, policy: Policy) -> bool:
    """One close of the re-risk condition (loss and drawdown below 12%, calm volatility)."""
    baseline_loss, hwm_dd = m.drawdowns(nav, policy.baseline)
    ratio = m.spike_ratio(nav.pct_change().dropna())
    return baseline_loss < policy.rerisk_loss and hwm_dd < policy.rerisk_loss and (ratio != ratio or ratio < policy.rerisk_spike_ratio)
