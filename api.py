from typing import Dict, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import Holding
from .engine import PortfolioQuantEngine

app = FastAPI(
    title="AI Portfolio Quant Engine API",
    description="Plug-and-play quantitative finance backend powered by yfinance.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Default demo portfolio
DEFAULT_HOLDINGS = [
    Holding(ticker="NVDA", shares=35, avg_cost=115.0),
    Holding(ticker="AAPL", shares=15, avg_cost=210.0),
    Holding(ticker="MSFT", shares=8, avg_cost=415.0),
    Holding(ticker="TSLA", shares=10, avg_cost=220.0),
    Holding(ticker="JNJ", shares=12, avg_cost=155.0),
]

engine = PortfolioQuantEngine(holdings=DEFAULT_HOLDINGS, cash=1000.0)


class TradeProposalRequest(BaseModel):
    ticker: str
    action: str = "BUY"
    shares: float
    max_concentration_pct: float = 10.0
    max_var_pct_of_equity: float = 1.5


class SimulationOverrideRequest(BaseModel):
    price_overrides: Optional[Dict[str, float]] = None
    headline_overrides: Optional[Dict[str, str]] = None


@app.on_event("startup")
def startup_load():
    engine.refresh_market_data(period="6mo")


@app.get("/api/snapshot")
def get_snapshot(target_beta: float = 0.70):
    """Returns all 5 mathematical models evaluated on the current portfolio."""
    return engine.get_full_frontend_payload(target_beta=target_beta)


@app.get("/api/stop-losses")
def get_stop_losses(k: float = 2.0):
    """Application 1: News-Reactive Dynamic Stop-Losses."""
    return [r.to_dict() for r in engine.evaluate_all_stop_losses(k=k)]


@app.get("/api/sleep-soundly")
def get_sleep_soundly(target_beta: float = 0.70):
    """Application 2: Portfolio Beta Reduction ('Sleep Soundly' Mode)."""
    return engine.calculate_sleep_soundly_rebalance(target_beta=target_beta).to_dict()


@app.get("/api/attribution")
def get_attribution():
    """Application 3: 'Why Is My Portfolio Bleeding?' Return Attribution."""
    return engine.calculate_portfolio_attribution().to_dict()


@app.get("/api/anomalies")
def get_anomalies(z_threshold: float = 2.0):
    """Application 4: Quant Anomaly & Momentum Detection (Z-Score & RSI)."""
    return [a.to_dict() for a in engine.detect_anomalies_and_momentum(z_threshold=z_threshold)]


@app.post("/api/guardrail")
def check_guardrail(req: TradeProposalRequest):
    """Application 5: 'Hype-Check' Guardrail (Trade Concentration & 1-Day VaR_95)."""
    return engine.evaluate_hype_check_guardrail(
        ticker=req.ticker,
        action=req.action,
        shares=req.shares,
        max_concentration_pct=req.max_concentration_pct,
        max_var_pct_of_equity=req.max_var_pct_of_equity,
    ).to_dict()


@app.post("/api/simulate")
def set_simulation(req: SimulationOverrideRequest):
    """Hackathon Time-Machine: Injects simulated prices or breaking headlines."""
    engine.set_simulation_override(
        price_overrides=req.price_overrides,
        headline_overrides=req.headline_overrides,
    )
    return engine.get_full_frontend_payload()


@app.post("/api/simulate/reset")
def reset_simulation():
    """Resets back to live yfinance prices and headlines."""
    engine.clear_simulation_overrides()
    return engine.get_full_frontend_payload()
