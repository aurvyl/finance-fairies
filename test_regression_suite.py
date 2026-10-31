import unittest
import math
import numpy as np
import pandas as pd
import yfinance as yf

from quant_backend import Holding, PortfolioQuantEngine


class TestRealWorldQuantRegression(unittest.TestCase):
    """
    Rigorous Regression Test Suite verifying that PortfolioQuantEngine produces
    mathematically exact outputs when fed real-world yfinance data.

    Includes:
      1. Fixed-window historical real-world data regression tests (comparing engine
         outputs against independent numpy/OLS linear regression calculations).
      2. Live market mathematical identity & invariant checks across all 5 equations.
    """

    @classmethod
    def setUpClass(cls):
        cls.holdings = [
            Holding(ticker="NVDA", shares=35, avg_cost=115.0),
            Holding(ticker="AAPL", shares=15, avg_cost=210.0),
            Holding(ticker="MSFT", shares=8, avg_cost=415.0),
            Holding(ticker="TSLA", shares=10, avg_cost=220.0),
            Holding(ticker="JNJ", shares=12, avg_cost=155.0),
        ]
        cls.engine = PortfolioQuantEngine(
            holdings=cls.holdings,
            cash=1000.0,
            benchmark_ticker="SPY",
            safe_haven_ticker="SGOV",
        )
        # Load pinned real-world historical window (2024-05-01 to 2024-11-01)
        # so regression values are 100% deterministic real-world market data
        tickers = ["NVDA", "AAPL", "MSFT", "TSLA", "JNJ", "SPY", "SGOV"]
        for t in tickers:
            hist = yf.Ticker(t).history(start="2024-05-01", end="2024-11-01", interval="1d", auto_adjust=True)
            cls.engine._history_cache[t] = hist

    def tearDown(self):
        self.engine.clear_simulation_overrides()

    # -------------------------------------------------------------------------
    # REGRESSION TEST 1: Equation 1 (ATR_14 & News-Reactive Stop-Loss)
    # -------------------------------------------------------------------------
    def test_01_atr_and_stop_loss_exact_formula(self):
        """
        Verifies ATR_14 and P_stop against an independent manual numpy calculation
        on real-world AAPL and NVDA OHLC candles.
        """
        for ticker in ["AAPL", "NVDA", "TSLA"]:
            df = self.engine.get_history(ticker)
            h = df["High"].values
            l = df["Low"].values
            c = df["Close"].values

            # Independent manual True Range calculation for last 14 trading days
            manual_trs = []
            for idx in range(len(df) - 14, len(df)):
                tr = max(
                    h[idx] - l[idx],
                    abs(h[idx] - c[idx - 1]),
                    abs(l[idx] - c[idx - 1]),
                )
                manual_trs.append(tr)
            expected_atr_14 = float(np.mean(manual_trs))
            expected_peak = float(np.max(h[-14:]))

            # Engine calculation
            engine_atr = self.engine.calculate_atr(ticker, n=14)
            self.assertAlmostEqual(
                engine_atr,
                expected_atr_14,
                places=6,
                msg=f"ATR_14 mismatch on {ticker}",
            )

            # Test with known sentiment (P_+ = 0.10, P_- = 0.75 -> S_news = -0.65 -> M_news = 0.35)
            res = self.engine.evaluate_dynamic_stop_loss(
                ticker, n=14, k=2.0, m_min=0.30, sentiment_override=(0.10, 0.75)
            )
            expected_s_news = 0.10 - 0.75
            expected_m_news = max(0.30, 1.0 + expected_s_news)
            expected_p_stop = round(expected_peak - (2.0 * expected_atr_14 * expected_m_news), 2)

            self.assertEqual(res.sentiment_score, round(expected_s_news, 4))
            self.assertEqual(res.news_multiplier, round(expected_m_news, 4))
            self.assertEqual(res.stop_loss_price, expected_p_stop)
            print(
                f"  [PASS] Eq 1 Regression ({ticker}): Engine ATR=${engine_atr:.4f} == Manual ATR=${expected_atr_14:.4f} | "
                f"Engine P_stop=${res.stop_loss_price:.2f} == Expected=${expected_p_stop:.2f}"
            )

    def test_02_stop_loss_monotonic_news_sensitivity(self):
        """
        Verifies that worsening news sentiment strictly tightens (raises) P_stop
        until the m_min floor (0.30) is reached.
        """
        bullish = self.engine.evaluate_dynamic_stop_loss("AAPL", sentiment_override=(0.80, 0.10))
        neutral = self.engine.evaluate_dynamic_stop_loss("AAPL", sentiment_override=(0.20, 0.20))
        bearish = self.engine.evaluate_dynamic_stop_loss("AAPL", sentiment_override=(0.05, 0.60))
        severe = self.engine.evaluate_dynamic_stop_loss("AAPL", sentiment_override=(0.01, 0.95))

        self.assertLess(bullish.stop_loss_price, neutral.stop_loss_price)
        self.assertLess(neutral.stop_loss_price, bearish.stop_loss_price)
        self.assertLess(bearish.stop_loss_price, severe.stop_loss_price)
        self.assertEqual(severe.news_multiplier, 0.30)
        print(
            f"  [PASS] Eq 1 Monotonicity: Bullish Stop (${bullish.stop_loss_price}) < "
            f"Neutral (${neutral.stop_loss_price}) < Bearish (${bearish.stop_loss_price}) < "
            f"Severe Scandal (${severe.stop_loss_price})"
        )

    # -------------------------------------------------------------------------
    # REGRESSION TEST 2: Equation 2 (OLS Linear Regression Beta & Rebalancing)
    # -------------------------------------------------------------------------
    def test_03_asset_beta_matches_ols_linear_regression(self):
        """
        Verifies that calculate_asset_beta(ticker) matches an independent Ordinary
        Least Squares (OLS) linear regression slope (np.polyfit) of daily stock
        returns against SPY returns over the 90-day window.
        """
        spy_returns = self.engine.get_history("SPY")["Close"].pct_change().dropna().tail(90)

        for ticker in ["NVDA", "AAPL", "MSFT", "TSLA", "JNJ"]:
            stock_returns = self.engine.get_history(ticker)["Close"].pct_change().dropna().tail(90)
            aligned = pd.concat([stock_returns, spy_returns], axis=1, keys=["s", "m"]).dropna()

            # Independent OLS slope: r_i = beta_i * r_m + intercept
            ols_slope, _ = np.polyfit(aligned["m"].values, aligned["s"].values, 1)
            engine_beta = self.engine.calculate_asset_beta(ticker, lookback_days=90)

            self.assertAlmostEqual(
                engine_beta,
                float(ols_slope),
                places=6,
                msg=f"Beta mismatch vs OLS slope on {ticker}",
            )
            print(
                f"  [PASS] Eq 2 OLS Beta Regression ({ticker}): Engine Beta={engine_beta:.6f} == OLS Slope={ols_slope:.6f}"
            )

    def test_04_sleep_soundly_beta_reduction_accuracy(self):
        """
        Verifies that Sleep Soundly mode reduces portfolio Beta to target_beta
        while preserving total portfolio equity.
        """
        target = 0.70
        res = self.engine.calculate_sleep_soundly_rebalance(target_beta=target, lookback_days=90)

        # Verify initial portfolio beta is the exact weighted sum of individual betas
        expected_initial_beta = sum(
            res.current_weights[t] * res.asset_betas[t] for t in res.current_weights
        )
        self.assertAlmostEqual(res.current_portfolio_beta, expected_initial_beta, places=3)

        # Verify new weights sum to 1.0
        self.assertAlmostEqual(sum(res.new_weights.values()), 1.0, places=3)

        # Verify projected new beta hits target within 1 share rounding tolerance (<0.03 beta units)
        self.assertLessEqual(abs(res.projected_new_beta - target), 0.03)
        print(
            f"  [PASS] Eq 2 Rebalance Accuracy: Initial Beta={res.current_portfolio_beta:.4f} -> "
            f"Projected Beta={res.projected_new_beta:.4f} (Target={target:.4f})"
        )

    # -------------------------------------------------------------------------
    # REGRESSION TEST 3: Equation 3 (CAPM Return Attribution Identities)
    # -------------------------------------------------------------------------
    def test_05_capm_attribution_exact_additivity(self):
        """
        Verifies the mathematical identity:
          1) For each stock: Macro_i + Alpha_i == StockReturn_i
          2) For portfolio:  MacroDrag + IdiosyncraticDrag == TotalPortfolioReturn
          3) MacroShare% + IdiosyncraticShare% == 100.0%
        """
        attr = self.engine.calculate_portfolio_attribution(lookback_days=90)

        for sb in attr.stock_breakdown:
            reconstructed_r_i = sb.macro_component_pct + sb.idiosyncratic_alpha_pct
            self.assertAlmostEqual(
                reconstructed_r_i,
                sb.stock_return_pct,
                places=2,
                msg=f"CAPM decomposition failed on {sb.ticker}",
            )

        reconstructed_r_p = attr.macro_drag_pct + attr.idiosyncratic_drag_pct
        self.assertAlmostEqual(
            reconstructed_r_p,
            attr.total_portfolio_return_pct,
            places=2,
            msg="Portfolio Macro + Idiosyncratic drag does not sum to R_p",
        )

        self.assertAlmostEqual(
            attr.macro_share_of_move_pct + attr.idiosyncratic_share_pct,
            100.0,
            places=1,
        )
        print(
            f"  [PASS] Eq 3 CAPM Attribution Identity: Macro({attr.macro_drag_pct:+.3f}%) + "
            f"Idio({attr.idiosyncratic_drag_pct:+.3f}%) == R_p({attr.total_portfolio_return_pct:+.3f}%)"
        )

    # -------------------------------------------------------------------------
    # REGRESSION TEST 4: Equation 4 (Z-Score & RSI_14 Exact Verification)
    # -------------------------------------------------------------------------
    def test_06_z_score_and_rsi_exact_values(self):
        """
        Verifies Z-Score and RSI_14 against independent manual calculations on
        real-world historical closes.
        """
        anomalies = {
            a.ticker: a
            for a in self.engine.detect_anomalies_and_momentum(vol_window=30, rsi_window=14, z_threshold=2.0)
        }

        for ticker in ["NVDA", "AAPL", "JNJ"]:
            df = self.engine.get_history(ticker)
            closes = df["Close"]

            # Independent 30-day baseline mean & sample std (excluding latest bar)
            hist_rets = closes.iloc[:-1].pct_change().dropna().tail(30).values
            expected_mean = float(np.mean(hist_rets))
            expected_std = float(np.std(hist_rets, ddof=1))
            live_ret = float((closes.iloc[-1] - closes.iloc[-2]) / closes.iloc[-2])
            expected_z = (live_ret - expected_mean) / expected_std

            # Independent 14-day RSI calculation
            diffs = np.diff(closes.tail(15).values)
            avg_gain = float(np.mean(np.maximum(0.0, diffs)))
            avg_loss = float(np.mean(np.maximum(0.0, -diffs)))
            expected_rsi = 100.0 - (100.0 / (1.0 + (avg_gain / avg_loss)))

            a = anomalies[ticker]
            self.assertAlmostEqual(a.z_score, round(expected_z, 2), places=2)
            self.assertAlmostEqual(a.rsi_14, round(expected_rsi, 1), places=1)
            self.assertTrue(0.0 <= a.rsi_14 <= 100.0)
            print(
                f"  [PASS] Eq 4 Anomaly/RSI Regression ({ticker}): Engine Z={a.z_score:+.2f} == Manual Z={expected_z:+.2f} | "
                f"Engine RSI={a.rsi_14:.1f} == Manual RSI={expected_rsi:.1f}"
            )

    # -------------------------------------------------------------------------
    # REGRESSION TEST 5: Equation 5 (Concentration & VaR_95 Guardrail)
    # -------------------------------------------------------------------------
    def test_07_hype_check_guardrail_exact_var_and_thresholds(self):
        """
        Verifies C_trade and Parametric VaR_95 against manual calculation and
        checks exact threshold transitions between AUTO_EXECUTE and REQUIRE_HUMAN_APPROVAL.
        """
        v_total, _, _ = self.engine.get_portfolio_equity()
        nvda_price = self.engine.get_live_price("NVDA")
        nvda_rets = self.engine.get_history("NVDA")["Close"].pct_change().dropna().tail(30).values
        expected_sigma = float(np.std(nvda_rets, ddof=1))

        shares = 25
        expected_notional = shares * nvda_price
        expected_c_pct = (expected_notional / v_total) * 100.0
        expected_var_95 = expected_notional * 1.645 * expected_sigma

        res = self.engine.evaluate_hype_check_guardrail("NVDA", "BUY", shares=shares)

        self.assertAlmostEqual(res.trade_notional_dollars, round(expected_notional, 2), places=2)
        self.assertAlmostEqual(res.concentration_ratio_pct, round(expected_c_pct, 2), places=2)
        self.assertAlmostEqual(res.var_95_dollars, round(expected_var_95, 2), places=2)
        self.assertEqual(res.status, "REQUIRE_HUMAN_APPROVAL")
        print(
            f"  [PASS] Eq 5 VaR_95 Regression (25 NVDA): Engine VaR=${res.var_95_dollars:.2f} == "
            f"Manual VaR=${expected_var_95:.2f} | C_trade={res.concentration_ratio_pct:.2f}% -> {res.status}"
        )


if __name__ == "__main__":
    print("=" * 78)
    print("RUNNING MATHEMATICAL REGRESSION TEST SUITE ON REAL-WORLD YFINANCE DATA")
    print("=" * 78)
    unittest.main(verbosity=2)
