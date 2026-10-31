"""Why did the portfolio move today? CAPM split into market and stock-specific parts.

r_i = beta_i * r_m + alpha_i  ->  R_p = beta_p * r_m + sum_i w_i * alpha_i

Betas are estimated on data up to the previous close, so today's move cannot bias them.
Components are reported with their signs; a share is only quoted when both point the
same way, because "70% market" is meaningless when the parts offset each other.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import metrics as m
from .config import BENCHMARK


def attribute_day(
    asset_returns: pd.DataFrame,
    weights: pd.Series,
    benchmark: str = BENCHMARK,
    window: int = 60,
    z_alert: float = 3.0,
) -> dict:
    """Split the latest day's portfolio return.

    asset_returns: daily returns up to and including the day being explained.
    weights: start-of-day weights (sum to the invested fraction; cash has beta 0).
    """
    today = asset_returns.iloc[-1]
    hist = asset_returns.iloc[-window - 1 : -1]
    r_m = float(today[benchmark])

    rows = []
    beta_p = 0.0
    alpha_total = 0.0
    for t, w in weights.items():
        if w <= 0 or t not in asset_returns.columns:
            continue
        b = m.beta(hist[t], hist[benchmark])
        r_i = float(today[t])
        alpha = r_i - b * r_m
        sd = float(hist[t].std(ddof=1))
        z = (r_i - float(hist[t].mean())) / sd if sd > 0 else float("nan")
        beta_p += w * b
        alpha_total += w * alpha
        rows.append({
            "ticker": t,
            "weight": float(w),
            "beta": b,
            "return": r_i,
            "market_part": b * r_m,
            "stock_specific": alpha,
            "contribution": float(w * r_i),
            "z_score": z,
            "unusual": bool(np.isfinite(z) and abs(z) >= z_alert),
        })

    market_part = beta_p * r_m
    total = market_part + alpha_total
    same_sign = market_part * alpha_total > 0
    share_market = abs(market_part) / (abs(market_part) + abs(alpha_total)) if same_sign else None
    if abs(total) < 1e-9:
        driver = "flat"
    elif not same_sign:
        driver = "market" if abs(market_part) >= abs(alpha_total) else "stock-specific"
        driver += " (partly offset)"
    else:
        driver = "market" if share_market >= 0.5 else "stock-specific"

    rows.sort(key=lambda r: r["contribution"])
    return {
        "portfolio_return": total,
        "benchmark": benchmark,
        "benchmark_return": r_m,
        "portfolio_beta": beta_p,
        "market_part": market_part,
        "stock_specific_part": alpha_total,
        "market_share": share_market,
        "main_driver": driver,
        "unusual_moves": [r["ticker"] for r in rows if r["unusual"]],
        "holdings": rows,
    }
