import pandas as pd
import pytest

from guardian import agent as agent_mod
from guardian.config import Policy, asset_class, sector_of
from guardian.llm import AgentRun
from guardian.rotation import caps_ok, stress_loss
from guardian.triggers import evaluate

from test_engine import synthetic_window


def make_ctx(policy=None):
    from guardian.rotation import engine_plan

    policy = policy or Policy()
    win = synthetic_window()
    w = pd.Series({t: 1 / 7 for t in policy.holdings})
    nav = pd.Series(10_000.0, index=win.returns.index)
    nav.iloc[-1] = 9_300.0
    trig = evaluate(nav, win.returns, w, policy)
    return {"date": "2025-01-27", "trigger": trig, "shock": {"label": "none"}, "weights": w, "window": win,
            "policy": policy, "engine_plan": engine_plan(w, win, policy), "max_steps": policy.max_steps}


def test_crypto_asset_class_caps_and_stress():
    assert asset_class("BTC-USD") == "crypto" and sector_of("ETH-USD") == "crypto"
    assert asset_class("GLD") == "etf" and asset_class("NVDA") == "equity"
    p = Policy()
    w0 = pd.Series({"NVDA": 0.9, "BTC-USD": 0.1})
    ok, why = caps_ok(pd.Series({"NVDA": 0.85, "BTC-USD": 0.15}), w0, p)
    assert not ok and any("BTC-USD" in s for s in why)
    assert stress_loss(pd.Series({"BTC-USD": 1.0}), "tech_down_30_defensive_down_15") == pytest.approx(0.45)
    assert stress_loss(pd.Series({"IEF": 1.0}), "equities_down_20") == pytest.approx(0.0)


def test_start_weights_normalised():
    p = Policy(holdings=["NVDA", "BTC-USD"], start_weights={"NVDA": 3, "BTC-USD": 1})
    assert p.initial_weights() == {"NVDA": 0.75, "BTC-USD": 0.25}


def test_agent_tools_verify_and_reject():
    ctx = make_ctx()
    tools, aux = agent_mod.make_tools(ctx)
    by = {t.name: t for t in tools}
    snap = by["get_risk_snapshot"].fn({})
    assert snap["trigger"]["kind"] == "rotation" and "attribution" in snap
    eng = ctx["engine_plan"].weights_after
    good = by["check_plan"].fn({"target_weights": [{"ticker": t, "weight": float(v)} for t, v in eng.items() if v > 0]})
    assert good["passed"], good["rejections"]
    bad = by["check_plan"].fn({"target_weights": [{"ticker": "KO", "weight": 1.0}]})
    assert not bad["passed"]
    with pytest.raises(ValueError):
        by["check_plan"].fn({"target_weights": [{"ticker": "TSLA", "weight": 1.0}]})


def test_guardian_agent_with_fake_provider(monkeypatch):
    ctx = make_ctx()

    def fake_run(provider, system, prompt, tools, final_tool, **kw):
        by = {t.name: t for t in tools}
        assert "do not search" in system  # replay mode forbids look-ahead news
        eng = ctx["engine_plan"].weights_after
        tw = [{"ticker": t, "weight": float(v)} for t, v in eng.items() if v > 0]
        res = by["check_plan"].fn({"target_weights": tw})
        run = AgentRun(provider, "fake")
        run.trace.append({"tool": "check_plan", "args": {}, "result": res})
        run.final = {"decision": "ROTATE", "target_weights": tw, "explanation": "test", "key_factors": ["semis"]}
        return run

    monkeypatch.setattr(agent_mod, "run_agent", fake_run)
    a = agent_mod.GuardianAgent("gemini")
    w = a(ctx)
    assert w and abs(sum(w.values()) - 1) < 1e-9
    assert ctx["agent_note"]["decision"] == "ROTATE" and ctx["agent_note"]["checks_run"] == 1


def test_missing_key_is_reported(monkeypatch):
    from guardian import llm

    monkeypatch.setattr(llm, "resolve_key", lambda provider, explicit=None: None)
    run = llm.run_agent("openrouter", "s", "p", [], "submit_plan")
    assert run.error and "OPENROUTER_API_KEY" in run.error


def test_api_endpoints():
    from pathlib import Path

    from fastapi.testclient import TestClient

    from guardian.api import app
    from guardian.data import DATA_DIR

    if not (Path(DATA_DIR) / "recent_2026_close.parquet").exists():
        pytest.skip("cached price data not present")
    c = TestClient(app)
    prov = c.get("/providers").json()
    assert prov["default"] == "gemini" and {p["id"] for p in prov["providers"]} == {"gemini", "openai", "anthropic", "openrouter"}
    lim = c.post("/limits", json={"max_drawdown": 0.10, "max_daily_loss": 0.02}).json()
    assert lim["thresholds"]["rotation_loss"] == pytest.approx(0.05)
    an = c.post("/analyze", json={"date": "2026-10-30"}).json()
    assert an["snapshot"]["shock"]["label"] == "broad-tech"
    what_if = c.post("/analyze", json={"date": "2026-10-29", "inject": {"NVDA": -0.15}}).json()
    assert what_if["snapshot"]["injected_shock"] == {"NVDA": -0.15}
    rp = c.post("/replay", json={}).json()
    assert set(rp["nav"]) == {"hold", "cash_exit", "guardian"}
