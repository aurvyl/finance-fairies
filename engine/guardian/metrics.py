"""Risk metrics. Every number the agent or UI shows comes from these functions.

Formula references (F1-F7) follow research v1, section 4.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

K = 252  # trading days per year
EPS = 1e-12


def returns(prices: pd.DataFrame) -> pd.DataFrame:
    """F1: simple daily returns."""
    return prices.pct_change().iloc[1:]


def realised_vol(r: pd.Series | pd.DataFrame, n: int, annualise: bool = False):
    """F3: sample standard deviation of the last n returns."""
    window = r.iloc[-n:]
    sd = window.std(ddof=1)
    return sd * np.sqrt(K) if annualise else sd


def spike_ratio(r: pd.Series) -> float:
    """F3: 5-day vol divided by the 60-day vol measured up to the previous day."""
    if len(r) < 62:
        return float("nan")
    short = r.iloc[-5:].std(ddof=1)
    long = r.iloc[-61:-1].std(ddof=1)
    return float(short / max(long, EPS))


def drawdowns(nav: pd.Series, baseline: float) -> tuple[float, float]:
    """F2: (loss versus baseline, drawdown from high-water mark), both >= 0."""
    hwm = nav.cummax().iloc[-1]
    v = nav.iloc[-1]
    return max(0.0, 1 - v / baseline), max(0.0, 1 - v / hwm)


def beta(r_asset: pd.Series, r_market: pd.Series) -> float:
    """F4: Cov(r_i, r_m) / Var(r_m)."""
    df = pd.concat([r_asset, r_market], axis=1).dropna()
    if len(df) < 2:
        return float("nan")
    cov = np.cov(df.iloc[:, 0], df.iloc[:, 1], ddof=1)
    return float(cov[0, 1] / max(cov[1, 1], EPS))


def shrunk_cov(r: pd.DataFrame, shrink: float) -> pd.DataFrame:
    """F4: daily covariance shrunk towards its diagonal."""
    s = r.cov(ddof=1)
    diag = pd.DataFrame(np.diag(np.diag(s.values)), index=s.index, columns=s.columns)
    return (1 - shrink) * s + shrink * diag


def portfolio_vol(w: pd.Series, cov_daily: pd.DataFrame) -> float:
    """F4: annualised portfolio volatility sqrt(K * w' S w)."""
    cols = cov_daily.columns
    wv = w.reindex(cols).fillna(0.0).values
    var = float(wv @ cov_daily.values @ wv)
    return float(np.sqrt(max(var, 0.0) * K))


def historical_cvar(w: pd.Series, r: pd.DataFrame, alpha: float) -> float:
    """F5: Rockafellar-Uryasev historical CVaR of the daily loss, as a positive fraction."""
    wv = w.reindex(r.columns).fillna(0.0)
    losses = -(r.fillna(0.0).values @ wv.values)
    n = len(losses)
    if n == 0:
        return float("nan")
    losses = np.sort(losses)
    z = np.quantile(losses, alpha)
    return float(z + np.maximum(losses - z, 0.0).sum() / ((1 - alpha) * n))


def adv_usd(close: pd.Series, volume: pd.Series, n: int = 20) -> float:
    """F7: 20-day average dollar volume."""
    return float((close.iloc[-n:] * volume.iloc[-n:]).mean())


def turnover(w_new: pd.Series, w_old: pd.Series) -> float:
    """F7: one-way turnover 0.5 * sum |w_new - w_old|."""
    idx = w_new.index.union(w_old.index)
    d = w_new.reindex(idx).fillna(0) - w_old.reindex(idx).fillna(0)
    return float(0.5 * d.abs().sum())


def trade_cost(w_new: pd.Series, w_old: pd.Series, cost_per_leg: float) -> float:
    """F7: cost as a fraction of NAV, sum c * |dw|."""
    idx = w_new.index.union(w_old.index)
    d = w_new.reindex(idx).fillna(0) - w_old.reindex(idx).fillna(0)
    return float(cost_per_leg * d.abs().sum())
