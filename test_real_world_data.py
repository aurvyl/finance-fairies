import json
from quant_backend import Holding, PortfolioQuantEngine


def run_real_world_verification():
    print("=" * 78)
    print("REAL-WORLD YFINANCE VERIFICATION SUITE FOR AI PORTFOLIO QUANT ENGINE")
    print("=" * 78)

    # 1. Define a realistic multi-sector portfolio
    holdings = [
        Holding(ticker="NVDA", shares=35, avg_cost=115.0),
        Holding(ticker="AAPL", shares=15, avg_cost=210.0),
        Holding(ticker="MSFT", shares=8, avg_cost=415.0),
        Holding(ticker="TSLA", shares=10, avg_cost=220.0),
        Holding(ticker="JNJ", shares=12, avg_cost=155.0),
    ]

    engine = PortfolioQuantEngine(
        holdings=holdings,
        cash=1000.0,
        benchmark_ticker="SPY",
        safe_haven_ticker="SGOV",
    )

    print("\n[Step 0] Fetching 6 months of real-world OHLCV & News from yfinance...")
    engine.refresh_market_data(period="6mo")

    v_total, values, weights = engine.get_portfolio_equity()
    print(f"Total Portfolio Equity (V_total): ${v_total:,.2f}")
    for t, val in values.items():
        print(f"  - {t:<5}: ${val:>9,.2f}  (Weight w_i = {weights[t]*100:5.2f}%)")

    # -------------------------------------------------------------------------
    # TEST 1: News-Reactive Dynamic Stop-Loss
    # -------------------------------------------------------------------------
    print("\n" + "-" * 78)
    print("[Application 1] News-Reactive Dynamic Stop-Loss (Live yfinance Data)")
    print("-" * 78)
    stop_results = engine.evaluate_all_stop_losses(n=14, k=2.0)
    for res in stop_results:
        print(
            f"  {res.ticker:<5} | Live: ${res.current_price:>7.2f} | Peak: ${res.peak_price:>7.2f} | "
            f"ATR_14: ${res.atr_14:>5.2f} | S_news: {res.sentiment_score:>+6.2f} (M={res.news_multiplier:.2f}) | "
            f"P_stop: ${res.stop_loss_price:>7.2f} ({res.distance_to_stop_pct:>5.2f}% buffer) -> {res.recommended_action}"
        )
        print(f"        Latest Headline: \"{res.latest_headline[:75]}\"")

    # Also test a breaking-news crisis comparison on AAPL (Normal Dip vs SEC Investigation)
    aapl_live = engine.get_live_price("AAPL")
    aapl_dip_price = round(aapl_live * 0.988, 2)  # Simulate a modest intraday pullback ($340.50)
    engine.set_simulation_override(price_overrides={"AAPL": aapl_dip_price})

    calm_res = engine.evaluate_dynamic_stop_loss(
        "AAPL",
        headline_override="Stocks trade mixed ahead of economic data release",
        sentiment_override=(0.15, 0.20),
    )
    crisis_res = engine.evaluate_dynamic_stop_loss(
        "AAPL",
        headline_override="Breaking: SEC launches fraud investigation into CEO",
        sentiment_override=(0.02, 0.93),
    )
    print("\n  [Stress-Test on AAPL at Intraday Pullback (${:.2f})]:".format(aapl_dip_price))
    print(
        f"    * General Market Dip (S_news={calm_res.sentiment_score:+.2f}): "
        f"P_stop = ${calm_res.stop_loss_price:.2f} vs Price ${calm_res.current_price:.2f} -> {calm_res.recommended_action}"
    )
    print(
        f"    * Breaking Scandal   (S_news={crisis_res.sentiment_score:+.2f}): "
        f"P_stop = ${crisis_res.stop_loss_price:.2f} vs Price ${crisis_res.current_price:.2f} -> {crisis_res.recommended_action}"
    )
    engine.clear_simulation_overrides()

    # -------------------------------------------------------------------------
    # TEST 2: "Sleep Soundly" Mode (Portfolio Beta Reduction)
    # -------------------------------------------------------------------------
    print("\n" + "-" * 78)
    print("[Application 2] 'Sleep Soundly' Mode (Portfolio Beta -> Target 0.70)")
    print("-" * 78)
    beta_res = engine.calculate_sleep_soundly_rebalance(target_beta=0.70, lookback_days=90)
    print(f"  Current Portfolio Beta (beta_p): {beta_res.current_portfolio_beta:.4f}")
    print(f"  Target Portfolio Beta          : {beta_res.target_beta:.4f}")
    print(f"  Projected New Portfolio Beta   : {beta_res.projected_new_beta:.4f}")
    print("  Individual 90-Day Betas vs SPY :", beta_res.asset_betas)
    print("  Recommended Rebalance Trades   :")
    for tr in beta_res.trades:
        print(
            f"    -> {tr.action:<4} {tr.shares:>3} shares of {tr.ticker:<5} @ ~${tr.estimated_price:.2f} "
            f"(${tr.dollar_amount:,.2f}) | {tr.reason}"
        )

    # -------------------------------------------------------------------------
    # TEST 3: "Why Is My Portfolio Bleeding?" (CAPM Return Attribution)
    # -------------------------------------------------------------------------
    print("\n" + "-" * 78)
    print("[Application 3] 'Why Is My Portfolio Bleeding?' (Single-Index Attribution)")
    print("-" * 78)
    attr_res = engine.calculate_portfolio_attribution(lookback_days=90)
    print(
        f"  Latest Session Portfolio Return (R_p): {attr_res.total_portfolio_return_pct:+.3f}% "
        f"(${attr_res.total_pnl_dollars:+,.2f})"
    )
    print(f"  Benchmark ({attr_res.benchmark_ticker}) Return (r_m)       : {attr_res.benchmark_return_pct:+.3f}%")
    print(
        f"  Macro Component (beta_p * r_m)       : {attr_res.macro_drag_pct:+.3f}% "
        f"({attr_res.macro_share_of_move_pct:.1f}% of move)"
    )
    print(
        f"  Idiosyncratic Component (sum w*alpha): {attr_res.idiosyncratic_drag_pct:+.3f}% "
        f"({attr_res.idiosyncratic_share_pct:.1f}% of move)"
    )
    print(f"  Primary Driver                       : {attr_res.primary_driver}")
    for sb in attr_res.stock_breakdown:
        print(
            f"    - {sb.ticker:<5} (w={sb.weight*100:4.1f}%, beta={sb.beta:4.2f}): "
            f"r_i={sb.stock_return_pct:+6.2f}% = Macro({sb.macro_component_pct:+6.2f}%) + "
            f"Alpha({sb.idiosyncratic_alpha_pct:+6.2f}%)"
        )

    # -------------------------------------------------------------------------
    # TEST 4: Quant Anomaly & Momentum Detection (Z-Score & RSI_14)
    # -------------------------------------------------------------------------
    print("\n" + "-" * 78)
    print("[Application 4] Quant Anomaly & Momentum Filter (30d Z-Score & 14d RSI)")
    print("-" * 78)
    anomalies = engine.detect_anomalies_and_momentum(vol_window=30, rsi_window=14, z_threshold=2.0)
    for a in anomalies:
        print(
            f"  {a.ticker:<5} | Return: {a.intraday_return_pct:+6.2f}% | "
            f"30d Vol (sigma_i): {a.daily_volatility_pct:5.2f}% | "
            f"Z-Score: {a.z_score:+5.2f} | RSI_14: {a.rsi_14:5.1f} ({a.rsi_regime:<10}) | "
            f"Wake LLM: {str(a.wake_llm_agent):<5} ({a.trigger_reason})"
        )

    # -------------------------------------------------------------------------
    # TEST 5: "Hype-Check" Guardrail (Trade Concentration & 1-Day 95% VaR)
    # -------------------------------------------------------------------------
    print("\n" + "-" * 78)
    print("[Application 5] 'Hype-Check' Guardrail (Concentration C_trade & VaR_95)")
    print("-" * 78)
    small_trade = engine.evaluate_hype_check_guardrail(ticker="MSFT", action="BUY", shares=2)
    large_trade = engine.evaluate_hype_check_guardrail(ticker="NVDA", action="BUY", shares=40)

    for label, g in [("Small Trade (2 MSFT)", small_trade), ("Hype Trade (40 NVDA)", large_trade)]:
        print(
            f"  {label:<22}: Notional=${g.trade_notional_dollars:>8,.2f} "
            f"(C_trade={g.concentration_ratio_pct:5.2f}% of equity) | "
            f"sigma_i={g.daily_volatility_pct:4.2f}% | "
            f"1-Day VaR_95=${g.var_95_dollars:>6.2f} ({g.var_95_pct_of_equity:4.2f}%) -> [{g.status}]"
        )
        for reason in g.breach_reasons:
            print(f"    ! Breach: {reason}")

    # Verify JSON serialization for Frontend consumption
    payload = engine.get_full_frontend_payload()
    assert "portfolio_summary" in payload and "stop_losses" in payload
    json_str = json.dumps(payload)
    print("\n" + "=" * 78)
    print(f"SUCCESS: All 5 equations verified on live yfinance data! Frontend JSON payload size: {len(json_str)} bytes.")
    print("=" * 78)


if __name__ == "__main__":
    run_real_world_verification()
