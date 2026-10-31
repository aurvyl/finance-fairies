"""Policy defaults and the demo universe.

Defaults follow research v1 (2026-10-31). They are prototype heuristics,
not calibrated by backtest.
"""

from __future__ import annotations

from dataclasses import dataclass, field

HOLDINGS = ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META"]
CANDIDATES = ["USMV", "SPLV", "XLP", "XLV", "XLU", "PG", "KO"]
BENCHMARK = "SPY"
REFERENCE = ["QQQ", "SMH"]
ALL_TICKERS = HOLDINGS + CANDIDATES + [BENCHMARK] + REFERENCE

ETFS = {"USMV", "SPLV", "XLP", "XLV", "XLU", "SPY", "QQQ", "SMH"}

SECTOR = {
    "NVDA": "semis",
    "AMD": "semis",
    "AVGO": "semis",
    "MSFT": "software",
    "GOOGL": "comm",
    "META": "comm",
    "AMZN": "discretionary",
    "USMV": "multi_lowvol",
    "SPLV": "multi_lowvol",
    "XLP": "staples",
    "XLV": "health",
    "XLU": "utilities",
    "PG": "staples",
    "KO": "staples",
}

# Sectors that take the larger hit in the "tech crash" stress scenario.
TECH_SECTORS = {"semis", "software", "comm", "discretionary"}


@dataclass(frozen=True)
class Policy:
    baseline: float = 10_000.0

    # Zones
    rotation_loss: float = 0.15
    hwm_drawdown: float = 0.15
    emergency_loss: float = 0.35

    # Shock and volatility spike
    shock_portfolio_return: float = -0.03
    shock_holding_return: float = -0.07
    shock_holding_contribution: float = 0.01
    spike_ratio: float = 1.8
    spike_min_annual_vol: float = 0.25

    cooldown_sessions: int = 3

    # Rotation
    step: float = 0.05
    max_steps: int = 4
    target_annual_vol: float = 0.15
    min_vol_reduction: float = 0.10

    # Candidate screen
    min_history: int = 60
    max_beta: float = 0.8
    max_vol_ratio: float = 0.75
    max_crash_corr: float = 0.7
    min_adv_usd: float = 20e6

    # Concentration caps
    cap_stock: float = 0.20
    cap_etf: float = 0.40
    cap_sector: float = 0.40

    # Costs (per leg, fraction of traded value)
    cost_per_leg: float = 0.0010
    max_cost_nav: float = 0.0010
    slippage: float = 0.0010

    # Risk estimation
    cov_window: int = 60
    cov_shrink: float = 0.20
    cvar_window: int = 252
    cvar_alpha: float = 0.95

    # Re-risk
    rerisk_min_sessions: int = 5
    rerisk_confirm_closes: int = 5
    rerisk_loss: float = 0.12
    rerisk_spike_ratio: float = 1.2

    # Daily risk budget (ex-ante): 99% one-day parametric VaR must stay under this limit.
    daily_var_limit: float | None = None
    var_z: float = 2.326  # one-sided 99%
    max_steps_budget: int = 10  # a budget rotation may move up to 50% in one go

    holdings: list[str] = field(default_factory=lambda: list(HOLDINGS))
    candidates: list[str] = field(default_factory=lambda: list(CANDIDATES))


def policy_from_limits(max_drawdown: float = 0.10, max_daily_loss: float = 0.02, baseline: float = 10_000.0, **overrides) -> Policy:
    """Turn the user's plain-language limits into engine thresholds.

    max_drawdown 10%  -> rotate once half the budget is used (-5%), emergency de-risk at 80% of it (-8%),
                         leaving a buffer because overnight gaps can jump past any line.
    max_daily_loss 2% -> 99% one-day VaR budget of 2% (act before a bad day) and a 2% shock trigger
                         (react after one).
    Limits are targets, not guarantees.
    """
    params = dict(
        baseline=baseline,
        rotation_loss=0.5 * max_drawdown,
        hwm_drawdown=0.5 * max_drawdown,
        emergency_loss=0.8 * max_drawdown,
        shock_portfolio_return=-max_daily_loss,
        daily_var_limit=max_daily_loss,
        rerisk_loss=0.8 * 0.5 * max_drawdown,  # recover comfortably inside the rotation line first
    )
    params.update(overrides)
    return Policy(**params)
