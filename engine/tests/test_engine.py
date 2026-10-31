import numpy as np
import pandas as pd
import pytest

from guardian import metrics as m
from guardian.config import Policy
from guardian.rotation import MarketWindow, caps_ok, check_plan, engine_plan
from guardian.triggers import evaluate

TICKERS = ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META", "USMV", "SPLV", "XLP", "XLV", "XLU", "PG", "KO", "SPY"]


def synthetic_window(n=300, seed=0, crash_last_day=True):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2024-01-01", periods=n)
    vol = {t: (0.03 if t in {"NVDA", "AMD", "AVGO"} else 0.02 if t in {"MSFT", "GOOGL", "AMZN", "META"} else 0.008) for t in TICKERS}
    market = rng.normal(0, 0.01, n)
    r = pd.DataFrame({t: market * (1.5 if vol[t] > 0.01 else 0.3) + rng.normal(0, vol[t], n) for t in TICKERS}, index=dates)
    if crash_last_day:
        r.loc[dates[-1], ["NVDA", "AMD", "AVGO"]] = -0.17
    close = 100 * (1 + r).cumprod()
    volume = pd.DataFrame(1e6, index=dates, columns=TICKERS)
    return MarketWindow(returns=r, close=close, volume=volume)


def test_drawdowns_and_vol():
    nav = pd.Series([100, 110, 99, 88])
    loss, dd = m.drawdowns(nav, baseline=100)
    assert loss == pytest.approx(0.12)
    assert dd == pytest.approx(0.2)
    r = pd.Series([0.01, -0.01] * 10)
    assert m.realised_vol(r, 20) == pytest.approx(r.std(ddof=1))


def test_cvar_is_tail_mean():
    r = pd.DataFrame({"A": np.linspace(-0.10, 0.09, 20)})
    w = pd.Series({"A": 1.0})
    cvar = m.historical_cvar(w, r, alpha=0.95)
    assert cvar == pytest.approx(0.10, abs=1e-9)  # worst 5% of 20 = the single worst day


def test_shock_trigger_fires_on_holding_crash():
    policy = Policy()
    win = synthetic_window()
    w = pd.Series({t: 1 / 7 for t in policy.holdings})
    nav = pd.Series(10_000.0, index=win.returns.index)
    nav.iloc[-1] = 9_300.0
    res = evaluate(nav, win.returns, w, policy)
    assert res.kind == "rotation"
    assert any("NVDA" in s for s in res.reasons)


def test_emergency_beats_rotation():
    policy = Policy()
    win = synthetic_window()
    nav = pd.Series(10_000.0, index=win.returns.index)
    nav.iloc[-1] = 6_400.0
    res = evaluate(nav, win.returns, pd.Series({"NVDA": 1.0}), policy)
    assert res.kind == "emergency"


def test_engine_plan_reduces_volatility_and_passes_checks():
    policy = Policy()
    win = synthetic_window()
    w = pd.Series({t: 1 / 7 for t in policy.holdings})
    plan = engine_plan(w, win, policy)
    assert plan.check.passed, plan.check.reasons
    assert plan.check.values["vol_after"] <= 0.9 * plan.check.values["vol_before"]
    assert plan.check.values["turnover"] <= 0.20 + 1e-9


def test_classify_shock_broad_vs_none():
    from guardian.triggers import classify_shock

    win = synthetic_window(crash_last_day=False)
    r = win.returns.copy()
    r["QQQ"] = r[["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META"]].mean(axis=1)
    r["SMH"] = r[["NVDA", "AMD", "AVGO"]].mean(axis=1)
    w = pd.Series({t: 1 / 7 for t in Policy().holdings})
    calm = classify_shock(r, w)
    assert calm["label"] == "none"
    r.iloc[-1] = -0.01
    r.loc[r.index[-1], ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META"]] = -0.04
    r.loc[r.index[-1], ["QQQ", "SMH"]] = -0.04
    r.loc[r.index[-1], "SPY"] = -0.02
    assert classify_shock(r, w)["label"] == "broad-tech"


def test_check_rejects_concentration_breach():
    policy = Policy()
    win = synthetic_window()
    w0 = pd.Series({t: 1 / 7 for t in policy.holdings})
    w1 = w0.copy()
    w1["NVDA"] -= 0.10
    w1["AMD"] -= 0.10
    w1["KO"] = 0.20
    w1["PG"] = 0.0
    bad = w1.copy()
    bad["KO"] += 0.05
    bad["MSFT"] -= 0.05
    check = check_plan(w0, bad, win, policy)
    assert not check.passed
    assert any("KO" in s and "cap" in s for s in check.reasons)
    assert caps_ok(w1, w0, policy)[0]
