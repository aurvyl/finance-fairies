import math
import warnings
from typing import List, Dict, Optional, Tuple, Any
import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*inplace.*")

from .models import (
    Holding,
    StopLossResult,
    RebalanceTrade,
    BetaShieldResult,
    StockAttribution,
    AttributionResult,
    AnomalyResult,
    GuardrailResult,
)


class FinancialSentimentScorer:
    """
    Scores financial news headlines into (P_+, P_-, P_0) probabilities.
    Automatically uses HuggingFace 'ProsusAI/finbert' if installed and enabled,
    with an instant, zero-latency financial lexicon fallback for offline/fast demos.
    """

    POSITIVE_TERMS = {
        "beat", "beats", "surge", "surges", "soar", "soars", "record", "upgrade",
        "upgrades", "bullish", "growth", "profit", "outperform", "buyback",
        "dividend", "breakthrough", "rally", "rallies", "strong", "raises",
        "approval", "approved", "partnership", "expansion", "optimism", "gain",
    }
    NEGATIVE_TERMS = {
        "sec", "investigation", "arrested", "fraud", "lawsuit", "miss", "misses",
        "plunge", "plunges", "crash", "downgrade", "downgrades", "bearish",
        "recall", "fire", "halt", "halted", "tariff", "tariffs", "ban", "probe",
        "subpoena", "default", "bankruptcy", "warning", "slump", "drop", "drops",
        "fall", "falls", "cut", "cuts", "layoffs", "fine", "penalty", "weak",
        "inflation", "hawkish", "recession", "delay", "delayed", "shortage",
    }

    def __init__(self, use_finbert: bool = False):
        self.pipe = None
        if use_finbert:
            try:
                from transformers import pipeline
                self.pipe = pipeline("sentiment-analysis", model="ProsusAI/finbert")
            except Exception:
                self.pipe = None

    def score_headline(self, headline: str) -> Tuple[float, float, float]:
        """
        Returns (P_positive, P_negative, P_neutral) summing to 1.0.
        Net sentiment S_news = P_positive - P_negative in [-1.0, +1.0].
        """
        if not headline or not headline.strip():
            return (0.15, 0.15, 0.70)

        if self.pipe is not None:
            try:
                results = self.pipe(headline, top_k=None)
                scores = {r["label"].lower(): float(r["score"]) for r in results}
                return (
                    scores.get("positive", 0.0),
                    scores.get("negative", 0.0),
                    scores.get("neutral", 0.0),
                )
            except Exception:
                pass

        # Fast deterministic financial lexicon scorer
        words = [
            w.strip(".,!?:;\"'()[]{}$%").lower()
            for w in headline.split()
        ]
        pos_hits = sum(1 for w in words if w in self.POSITIVE_TERMS)
        neg_hits = sum(1 for w in words if w in self.NEGATIVE_TERMS)

        if pos_hits == 0 and neg_hits == 0:
            return (0.15, 0.15, 0.70)

        total_hits = pos_hits + neg_hits
        # Scale confidence with number of strong financial trigger words
        intensity = min(0.92, 0.45 + 0.22 * total_hits)
        p_pos = intensity * (pos_hits / total_hits)
        p_neg = intensity * (neg_hits / total_hits)
        p_neu = max(0.0, 1.0 - (p_pos + p_neg))
        return (round(p_pos, 4), round(p_neg, 4), round(p_neu, 4))


class PortfolioQuantEngine:
    """
    Plug-and-play Quantitative Backend Library for the AI Investment Agent.
    Fetches real-world market & news data via yfinance and executes all 5 core
    mathematical applications.
    """

    def __init__(
        self,
        holdings: List[Holding],
        cash: float = 0.0,
        benchmark_ticker: str = "SPY",
        safe_haven_ticker: str = "SGOV",
        use_finbert: bool = False,
    ):
        self.holdings: Dict[str, Holding] = {h.ticker.upper(): h for h in holdings}
        self.cash: float = float(cash)
        self.benchmark_ticker: str = benchmark_ticker.upper()
        self.safe_haven_ticker: str = safe_haven_ticker.upper()
        self.sentiment_scorer = FinancialSentimentScorer(use_finbert=use_finbert)

        # Cached market data from yfinance
        self._history_cache: Dict[str, pd.DataFrame] = {}
        self._news_cache: Dict[str, List[str]] = {}
        # Optional simulated price overrides for hackathon demo ("Time Machine" button)
        self._price_overrides: Dict[str, float] = {}
        self._headline_overrides: Dict[str, str] = {}

    # -------------------------------------------------------------------------
    # DATA LAYER: YFINANCE REAL-WORLD DATA INGESTION
    # -------------------------------------------------------------------------

    def refresh_market_data(self, period: str = "6mo") -> None:
        """
        Downloads historical daily OHLCV candles and latest news headlines from
        yfinance for all portfolio holdings, the benchmark (SPY), and safe haven (SGOV).
        """
        tickers = list(
            set(list(self.holdings.keys()) + [self.benchmark_ticker, self.safe_haven_ticker])
        )
        for ticker in tickers:
            t_obj = yf.Ticker(ticker)
            hist = t_obj.history(period=period, interval="1d", auto_adjust=True)
            if hist is not None and not hist.empty:
                self._history_cache[ticker] = hist

            # Fetch latest real-world headlines from yfinance
            try:
                raw_news = t_obj.news or []
                headlines = []
                for item in raw_news[:5]:
                    # Support both legacy and nested yfinance news schemas
                    title = item.get("title") or item.get("content", {}).get("title", "")
                    if title:
                        headlines.append(title)
                self._news_cache[ticker] = headlines
            except Exception:
                self._news_cache[ticker] = []

    def get_history(self, ticker: str) -> pd.DataFrame:
        """Returns cached OHLCV DataFrame for a ticker, fetching from yfinance if needed."""
        ticker = ticker.upper()
        if ticker not in self._history_cache:
            t_obj = yf.Ticker(ticker)
            hist = t_obj.history(period="6mo", interval="1d", auto_adjust=True)
            if hist is None or hist.empty:
                raise ValueError(f"Could not fetch yfinance history for ticker '{ticker}'.")
            self._history_cache[ticker] = hist
        return self._history_cache[ticker]

    def get_live_price(self, ticker: str) -> float:
        """Returns latest real-world close/live price (or simulated override if active)."""
        ticker = ticker.upper()
        if ticker in self._price_overrides:
            return float(self._price_overrides[ticker])
        df = self.get_history(ticker)
        return float(df["Close"].iloc[-1])

    def get_latest_headline(self, ticker: str) -> str:
        """Returns top news headline from yfinance (or simulated override if active)."""
        ticker = ticker.upper()
        if ticker in self._headline_overrides:
            return self._headline_overrides[ticker]
        if ticker not in self._news_cache:
            try:
                raw_news = yf.Ticker(ticker).news or []
                headlines = [
                    item.get("title") or item.get("content", {}).get("title", "")
                    for item in raw_news[:5]
                ]
                self._news_cache[ticker] = [h for h in headlines if h]
            except Exception:
                self._news_cache[ticker] = []
        headlines = self._news_cache.get(ticker, [])
        return headlines[0] if headlines else "No major company-specific headlines today."

    def set_simulation_override(
        self,
        price_overrides: Optional[Dict[str, float]] = None,
        headline_overrides: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        Hackathon 'Time Machine' hook: allows the frontend to inject simulated
        price shocks or breaking news headlines when markets are closed on weekends.
        """
        if price_overrides is not None:
            self._price_overrides = {k.upper(): float(v) for k, v in price_overrides.items()}
        if headline_overrides is not None:
            self._headline_overrides = {k.upper(): str(v) for k, v in headline_overrides.items()}

    def clear_simulation_overrides(self) -> None:
        """Resets the engine back to pure live yfinance data."""
        self._price_overrides.clear()
        self._headline_overrides.clear()

    def get_portfolio_equity(self) -> Tuple[float, Dict[str, float], Dict[str, float]]:
        """
        Computes total portfolio equity V_total, dollar value V_i per holding,
        and weight w_i = V_i / V_total.
        """
        values: Dict[str, float] = {}
        for ticker, holding in self.holdings.items():
            values[ticker] = holding.shares * self.get_live_price(ticker)
        if self.cash > 0:
            values["CASH"] = self.cash

        v_total = sum(values.values())
        weights = {k: (v / v_total if v_total > 0 else 0.0) for k, v in values.items()}
        return v_total, values, weights

    # -------------------------------------------------------------------------
    # APPLICATION 1: NEWS-REACTIVE DYNAMIC STOP-LOSS
    # Equations:
    #   TR_t = max(H_t - L_t, |H_t - C_{t-1}|, |L_t - C_{t-1}|)
    #   ATR_n = (1 / n) * sum(TR)
    #   S_news = P_+ - P_- ,   M_news = max(m_min, 1 + S_news)
    #   P_stop = P_peak - (k * ATR_n * M_news)
    # -------------------------------------------------------------------------

    def calculate_atr(self, ticker: str, n: int = 14) -> float:
        """Calculates the n-period Average True Range (ATR_n) from yfinance OHLC data."""
        df = self.get_history(ticker)
        high = df["High"]
        low = df["Low"]
        prev_close = df["Close"].shift(1)

        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()

        true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1).dropna()
        return float(true_range.tail(n).mean())

    def evaluate_dynamic_stop_loss(
        self,
        ticker: str,
        n: int = 14,
        k: float = 2.0,
        m_min: float = 0.30,
        headline_override: Optional[str] = None,
        sentiment_override: Optional[Tuple[float, float]] = None,
    ) -> StopLossResult:
        """
        Runs Equation 1 for a single ticker using real-world OHLC & news from yfinance.
        """
        ticker = ticker.upper()
        df = self.get_history(ticker)
        current_price = self.get_live_price(ticker)
        atr_n = self.calculate_atr(ticker, n=n)

        # Peak price defaults to rolling n-day High if not explicitly set on the holding
        holding = self.holdings.get(ticker)
        rolling_high = float(df["High"].tail(n).max())
        peak_price = (
            float(holding.peak_price)
            if (holding and holding.peak_price is not None)
            else max(rolling_high, current_price)
        )

        headline = headline_override if headline_override is not None else self.get_latest_headline(ticker)
        if sentiment_override is not None:
            p_pos, p_neg = sentiment_override
        else:
            p_pos, p_neg, _ = self.sentiment_scorer.score_headline(headline)

        s_news = float(p_pos - p_neg)
        m_news = max(m_min, 1.0 + s_news)
        p_stop = peak_price - (k * atr_n * m_news)

        distance_pct = ((current_price - p_stop) / current_price) * 100.0
        triggered = bool(current_price <= p_stop)

        return StopLossResult(
            ticker=ticker,
            current_price=round(current_price, 2),
            peak_price=round(peak_price, 2),
            atr_14=round(atr_n, 2),
            k_multiplier=k,
            sentiment_score=round(s_news, 4),
            news_multiplier=round(m_news, 4),
            stop_loss_price=round(p_stop, 2),
            distance_to_stop_pct=round(distance_pct, 2),
            triggered=triggered,
            recommended_action="SELL_IMMEDIATELY" if triggered else "HOLD",
            latest_headline=headline,
        )

    def evaluate_all_stop_losses(self, n: int = 14, k: float = 2.0) -> List[StopLossResult]:
        """Evaluates News-Reactive Dynamic Stop-Losses across all portfolio holdings."""
        return [
            self.evaluate_dynamic_stop_loss(ticker, n=n, k=k)
            for ticker in self.holdings
        ]

    # -------------------------------------------------------------------------
    # APPLICATION 2: "SLEEP SOUNDLY" MODE (PORTFOLIO BETA REDUCTION)
    # Equations:
    #   beta_i = Cov(r_i, r_m) / Var(r_m)
    #   w_i = V_i / V_total ,   beta_p = sum(w_i * beta_i)
    #   Delta V_H = V_total * (beta_p - beta_target) / (beta_H - beta_rf)
    # -------------------------------------------------------------------------

    def calculate_asset_beta(self, ticker: str, lookback_days: int = 90) -> float:
        """
        Calculates rolling historical Beta of a ticker relative to benchmark (SPY)
        using daily returns over lookback_days.
        """
        ticker = ticker.upper()
        if ticker == "CASH":
            return 0.0
        if ticker == self.benchmark_ticker:
            return 1.0

        stock_df = self.get_history(ticker)
        bench_df = self.get_history(self.benchmark_ticker)

        combined = pd.DataFrame({
            "stock": stock_df["Close"].pct_change(),
            "bench": bench_df["Close"].pct_change(),
        }).dropna().tail(lookback_days)

        if len(combined) < 5:
            return 1.0

        var_m = float(combined["bench"].var(ddof=1))
        if var_m == 0:
            return 0.0
        cov_im = float(combined["stock"].cov(combined["bench"]))
        return cov_im / var_m

    def calculate_sleep_soundly_rebalance(
        self,
        target_beta: float = 0.70,
        lookback_days: int = 90,
    ) -> BetaShieldResult:
        """
        Runs Equation 2 to compute exact dollar and share amounts to rotate from
        high-Beta stocks into the safe-haven asset (SGOV) to reach target_beta.
        """
        v_total, values, weights = self.get_portfolio_equity()
        asset_betas: Dict[str, float] = {}
        for ticker in weights:
            asset_betas[ticker] = round(self.calculate_asset_beta(ticker, lookback_days), 4)

        beta_rf = round(self.calculate_asset_beta(self.safe_haven_ticker, lookback_days), 4)
        # Treasury ETFs like SGOV have near-zero beta
        if abs(beta_rf) < 0.05:
            beta_rf = 0.0

        current_beta_p = sum(weights[t] * asset_betas[t] for t in weights)

        # Work on a mutable copy of dollar values to support cascading across high-beta stocks
        updated_values = dict(values)
        updated_values.setdefault(self.safe_haven_ticker, 0.0)
        asset_betas.setdefault(self.safe_haven_ticker, beta_rf)

        trades: List[RebalanceTrade] = []
        running_beta = current_beta_p

        # Sort risky holdings from highest Beta to lowest Beta
        candidates = sorted(
            [t for t in self.holdings if asset_betas.get(t, 0.0) > max(target_beta, beta_rf)],
            key=lambda t: asset_betas[t],
            reverse=True,
        )

        total_rotated_dollars = 0.0
        for ticker_h in candidates:
            if running_beta <= target_beta + 1e-4:
                break

            beta_h = asset_betas[ticker_h]
            if beta_h <= beta_rf:
                continue

            # Exact Equation 2: Delta V_H = V_total * (beta_p - beta_target) / (beta_H - beta_rf)
            delta_v_needed = v_total * ((running_beta - target_beta) / (beta_h - beta_rf))
            available_v = updated_values.get(ticker_h, 0.0)
            delta_v_actual = min(delta_v_needed, available_v)

            price_h = self.get_live_price(ticker_h)
            shares_to_sell = int(round(delta_v_actual / price_h))
            max_shares = int(self.holdings[ticker_h].shares)
            shares_to_sell = min(shares_to_sell, max_shares)

            if shares_to_sell <= 0:
                continue

            actual_dollars = shares_to_sell * price_h
            updated_values[ticker_h] -= actual_dollars
            updated_values[self.safe_haven_ticker] += actual_dollars
            total_rotated_dollars += actual_dollars

            # Update running portfolio beta after this sale
            running_beta -= (actual_dollars / v_total) * (beta_h - beta_rf)

            trades.append(
                RebalanceTrade(
                    ticker=ticker_h,
                    action="SELL",
                    shares=shares_to_sell,
                    estimated_price=round(price_h, 2),
                    dollar_amount=round(actual_dollars, 2),
                    current_beta=round(beta_h, 2),
                    reason=f"Trim high-Beta ({beta_h:.2f}) exposure to reduce portfolio volatility.",
                )
            )

        if total_rotated_dollars > 0:
            price_rf = self.get_live_price(self.safe_haven_ticker)
            shares_rf = int(math.floor(total_rotated_dollars / price_rf))
            if shares_rf > 0:
                trades.append(
                    RebalanceTrade(
                        ticker=self.safe_haven_ticker,
                        action="BUY",
                        shares=shares_rf,
                        estimated_price=round(price_rf, 2),
                        dollar_amount=round(shares_rf * price_rf, 2),
                        current_beta=round(beta_rf, 2),
                        reason=f"Rotate proceeds into low-volatility {self.safe_haven_ticker} (Beta {beta_rf:.2f}).",
                    )
                )

        new_weights = {
            k: round(v / v_total, 4) for k, v in updated_values.items() if v > 0 and v_total > 0
        }
        projected_beta = sum(new_weights[t] * asset_betas.get(t, 0.0) for t in new_weights)

        return BetaShieldResult(
            total_equity=round(v_total, 2),
            current_portfolio_beta=round(current_beta_p, 4),
            target_beta=round(target_beta, 4),
            projected_new_beta=round(projected_beta, 4),
            safe_haven_ticker=self.safe_haven_ticker,
            safe_haven_beta=round(beta_rf, 4),
            asset_betas=asset_betas,
            current_weights={k: round(w, 4) for k, w in weights.items()},
            new_weights=new_weights,
            trades=trades,
        )

    # -------------------------------------------------------------------------
    # APPLICATION 3: "WHY IS MY PORTFOLIO BLEEDING?" (CAPM ATTRIBUTION)
    # Equations:
    #   r_i = beta_i * r_m + alpha_i
    #   R_p = sum(w_i * r_i) = (beta_p * r_m) + sum(w_i * alpha_i)
    # -------------------------------------------------------------------------

    def get_latest_daily_return(self, ticker: str) -> float:
        """
        Computes latest single-day fractional return r_i = (P_live - C_{t-1}) / C_{t-1}.
        """
        ticker = ticker.upper()
        if ticker == "CASH":
            return 0.0
        df = self.get_history(ticker)
        prev_close = float(df["Close"].iloc[-2])
        current_price = self.get_live_price(ticker)
        return (current_price - prev_close) / prev_close

    def calculate_portfolio_attribution(
        self,
        lookback_days: int = 90,
    ) -> AttributionResult:
        """
        Runs Equation 3 to decompose today's portfolio return into Macro/Market Drag
        (beta_p * r_m) vs. Stock-Specific Idiosyncratic Drag (sum w_i * alpha_i).
        """
        v_total, _, weights = self.get_portfolio_equity()
        r_m = self.get_latest_daily_return(self.benchmark_ticker)

        breakdown: List[StockAttribution] = []
        beta_p = 0.0
        r_p = 0.0
        idio_total = 0.0

        for ticker, weight in weights.items():
            beta_i = self.calculate_asset_beta(ticker, lookback_days=lookback_days)
            r_i = self.get_latest_daily_return(ticker)
            macro_comp = beta_i * r_m
            alpha_i = r_i - macro_comp
            contrib = weight * r_i

            beta_p += weight * beta_i
            r_p += contrib
            idio_total += weight * alpha_i

            if ticker != "CASH":
                breakdown.append(
                    StockAttribution(
                        ticker=ticker,
                        weight=round(weight, 4),
                        beta=round(beta_i, 3),
                        stock_return_pct=round(r_i * 100.0, 3),
                        macro_component_pct=round(macro_comp * 100.0, 3),
                        idiosyncratic_alpha_pct=round(alpha_i * 100.0, 3),
                        portfolio_contribution_pct=round(contrib * 100.0, 3),
                        latest_headline=self.get_latest_headline(ticker),
                    )
                )

        macro_drag = beta_p * r_m
        # Share of total move explained by Macro vs Stock-Specific
        denom = abs(macro_drag) + abs(idio_total)
        if denom > 1e-9:
            macro_share = (abs(macro_drag) / denom) * 100.0
            idio_share = (abs(idio_total) / denom) * 100.0
        else:
            macro_share, idio_share = 50.0, 50.0

        total_pnl_dollars = v_total * r_p
        primary_driver = "MACRO_MARKET" if macro_share >= idio_share else "STOCK_SPECIFIC"

        # Sort breakdown by worst portfolio contribution first
        breakdown.sort(key=lambda x: x.portfolio_contribution_pct)

        return AttributionResult(
            total_portfolio_return_pct=round(r_p * 100.0, 3),
            total_pnl_dollars=round(total_pnl_dollars, 2),
            benchmark_ticker=self.benchmark_ticker,
            benchmark_return_pct=round(r_m * 100.0, 3),
            portfolio_beta=round(beta_p, 3),
            macro_drag_pct=round(macro_drag * 100.0, 3),
            idiosyncratic_drag_pct=round(idio_total * 100.0, 3),
            macro_share_of_move_pct=round(macro_share, 1),
            idiosyncratic_share_pct=round(idio_share, 1),
            primary_driver=primary_driver,
            stock_breakdown=breakdown,
        )

    # -------------------------------------------------------------------------
    # APPLICATION 4: QUANT ANOMALY & MOMENTUM DETECTION (Z-SCORE & RSI)
    # Equations:
    #   sigma_i = sqrt( (1 / (n - 1)) * sum((r_{i,k} - \bar{r}_i)^2) )
    #   Z_{i,t} = (r_{i,t} - \bar{r}_i) / sigma_i
    #   RS_n = AvgGain_n / AvgLoss_n ,   RSI_n = 100 - (100 / (1 + RS_n))
    # -------------------------------------------------------------------------

    def calculate_rsi(self, ticker: str, n: int = 14) -> float:
        """Calculates the n-period Relative Strength Index (RSI_n)."""
        df = self.get_history(ticker)
        closes = df["Close"].copy()
        if ticker.upper() in self._price_overrides:
            closes.iloc[-1] = self._price_overrides[ticker.upper()]

        delta = closes.diff().dropna().tail(n)
        gains = delta.clip(lower=0.0)
        losses = (-delta).clip(lower=0.0)

        avg_gain = float(gains.mean())
        avg_loss = float(losses.mean())

        if avg_loss == 0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def detect_anomalies_and_momentum(
        self,
        vol_window: int = 30,
        rsi_window: int = 14,
        z_threshold: float = 2.0,
    ) -> List[AnomalyResult]:
        """
        Runs Equation 4 across all holdings to filter daily noise and determine
        which stocks have a statistically significant Z-Score or extreme RSI.
        """
        results: List[AnomalyResult] = []
        for ticker in self.holdings:
            df = self.get_history(ticker)
            # Historical daily returns excluding today's live bar for baseline mean & std
            hist_returns = df["Close"].iloc[:-1].pct_change().dropna().tail(vol_window)
            mean_r = float(hist_returns.mean())
            sigma_r = float(hist_returns.std(ddof=1))

            live_r = self.get_latest_daily_return(ticker)
            z_score = (live_r - mean_r) / sigma_r if sigma_r > 0 else 0.0
            rsi_val = self.calculate_rsi(ticker, n=rsi_window)

            if rsi_val <= 30.0:
                rsi_regime = "OVERSOLD"
            elif rsi_val >= 70.0:
                rsi_regime = "OVERBOUGHT"
            else:
                rsi_regime = "NEUTRAL"

            reasons = []
            if abs(z_score) >= z_threshold:
                direction = "drop" if z_score < 0 else "surge"
                reasons.append(f"Abnormal { abs(z_score):.2f}-sigma price {direction}")
            if rsi_regime != "NEUTRAL":
                reasons.append(f"RSI_14 is {rsi_regime} ({rsi_val:.1f})")

            wake_agent = len(reasons) > 0
            trigger_reason = "; ".join(reasons) if wake_agent else "Within normal daily volatility"

            results.append(
                AnomalyResult(
                    ticker=ticker,
                    current_price=round(self.get_live_price(ticker), 2),
                    intraday_return_pct=round(live_r * 100.0, 2),
                    mean_daily_return_pct=round(mean_r * 100.0, 3),
                    daily_volatility_pct=round(sigma_r * 100.0, 2),
                    z_score=round(z_score, 2),
                    rsi_14=round(rsi_val, 1),
                    rsi_regime=rsi_regime,
                    wake_llm_agent=wake_agent,
                    trigger_reason=trigger_reason,
                )
            )
        return results

    # -------------------------------------------------------------------------
    # APPLICATION 5: THE "HYPE-CHECK" GUARDRAIL (CONCENTRATION & VaR_95)
    # Equations:
    #   C_trade = (Q_trade * P_i) / V_total
    #   VaR_alpha = V_position * z_alpha * sigma_i
    # -------------------------------------------------------------------------

    def evaluate_hype_check_guardrail(
        self,
        ticker: str,
        action: str,
        shares: float,
        max_concentration_pct: float = 10.0,
        max_var_pct_of_equity: float = 1.5,
        z_alpha: float = 1.645,  # 95% one-tailed normal confidence
        vol_window: int = 30,
    ) -> GuardrailResult:
        """
        Runs Equation 5 to intercept an AI tool call (buy_stock / sell_stock)
        and decide whether it can auto-execute or must prompt human approval.
        """
        ticker = ticker.upper()
        price = self.get_live_price(ticker)
        v_total, _, _ = self.get_portfolio_equity()

        df = self.get_history(ticker)
        hist_returns = df["Close"].pct_change().dropna().tail(vol_window)
        sigma_i = float(hist_returns.std(ddof=1))

        trade_notional = float(shares) * price
        c_trade_pct = (trade_notional / v_total) * 100.0 if v_total > 0 else 100.0

        var_95_dollars = trade_notional * z_alpha * sigma_i
        var_95_pct_equity = (var_95_dollars / v_total) * 100.0 if v_total > 0 else 100.0

        breaches = []
        if c_trade_pct > max_concentration_pct:
            breaches.append(
                f"Trade size ({c_trade_pct:.1f}% of portfolio) exceeds {max_concentration_pct:.1f}% concentration limit"
            )
        if var_95_pct_equity > max_var_pct_of_equity:
            breaches.append(
                f"1-Day 95% VaR (${var_95_dollars:.2f} / {var_95_pct_equity:.2f}% of equity) exceeds {max_var_pct_of_equity:.2f}% risk cap"
            )

        status = "REQUIRE_HUMAN_APPROVAL" if breaches else "AUTO_EXECUTE"

        return GuardrailResult(
            ticker=ticker,
            action=action.upper(),
            shares=shares,
            live_price=round(price, 2),
            trade_notional_dollars=round(trade_notional, 2),
            total_portfolio_equity=round(v_total, 2),
            concentration_ratio_pct=round(c_trade_pct, 2),
            daily_volatility_pct=round(sigma_i * 100.0, 2),
            var_95_dollars=round(var_95_dollars, 2),
            var_95_pct_of_equity=round(var_95_pct_equity, 2),
            status=status,
            breach_reasons=breaches,
        )

    # -------------------------------------------------------------------------
    # UNIFIED FRONTEND PAYLOAD
    # -------------------------------------------------------------------------

    def get_full_frontend_payload(self, target_beta: float = 0.70) -> Dict[str, Any]:
        """
        Single method for the frontend/API to get all 5 mathematical models
        evaluated on the live portfolio in one JSON-serializable dictionary.
        """
        v_total, values, weights = self.get_portfolio_equity()
        return {
            "portfolio_summary": {
                "total_equity": round(v_total, 2),
                "cash": round(self.cash, 2),
                "position_values": {k: round(v, 2) for k, v in values.items()},
                "weights": {k: round(w, 4) for k, w in weights.items()},
            },
            "stop_losses": [r.to_dict() for r in self.evaluate_all_stop_losses()],
            "sleep_soundly_rebalance": self.calculate_sleep_soundly_rebalance(target_beta=target_beta).to_dict(),
            "daily_attribution": self.calculate_portfolio_attribution().to_dict(),
            "anomalies_and_momentum": [a.to_dict() for a in self.detect_anomalies_and_momentum()],
        }
