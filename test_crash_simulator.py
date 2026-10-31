from quant_backend import Holding, PortfolioQuantEngine, MarketCrashSimulator


def print_simulation_report(res):
    print("\n" + "=" * 82)
    print(f"SCENARIO: {res.scenario_name}")
    print(f"DESC    : {res.description}")
    print("-" * 82)
    print(f"Initial Portfolio Equity : ${res.initial_equity:>10,.2f}   (Simulated over {res.days_simulated} trading days)")
    print(f"Stock Shocks Applied (%) : {res.stock_shocks_applied_pct}")
    print("-" * 82)
    print(f"{'Strategy / Benchmark':<30} | {'Final Equity':>13} | {'Total Return':>12} | {'Max Drawdown':>12}")
    print("-" * 82)
    print(
        f"{'1. AI-Protected Portfolio':<30} | ${res.ai_final_equity:>12,.2f} | "
        f"{res.ai_total_return_pct:>+11.2f}% | {res.ai_max_drawdown_pct:>11.2f}%"
    )
    print(
        f"{'2. Unprotected Buy & Hold':<30} | ${res.unprotected_final_equity:>12,.2f} | "
        f"{res.unprotected_total_return_pct:>+11.2f}% | {res.unprotected_max_drawdown_pct:>11.2f}%"
    )
    print(
        f"{'3. S&P 500 Benchmark (SPY)':<30} | ${res.benchmark_final_equity:>12,.2f} | "
        f"{res.benchmark_total_return_pct:>+11.2f}% | {res.benchmark_max_drawdown_pct:>11.2f}%"
    )
    print("-" * 82)
    print(
        f"-> Dollars Saved by AI vs. Unprotected : ${res.dollars_saved_vs_unprotected:+,.2f} "
        f"({res.outperformance_vs_unprotected_pct:+.2f}% outperformance)"
    )
    print(
        f"-> Net Performance vs. S&P 500 (SPY)   : ${res.dollars_saved_vs_benchmark:+,.2f} "
        f"({res.outperformance_vs_benchmark_pct:+.2f}% vs. market)"
    )
    print(f"-> Downside Capture Ratio              : {res.downside_capture_ratio_pct:.1f}% of unprotected loss")

    print("\nAutonomous AI Actions Triggered:")
    for act in res.ai_action_log:
        print(f"  * {act}")

    print("\nDay-by-Day Equity Trajectory (Sampled):")
    for step in res.daily_timeline:
        if step.day in (0, 1, 2, 3, 5, res.days_simulated):
            print(
                f"  {step.label:<18} | AI: ${step.ai_equity:>9,.2f} ({step.ai_return_pct:+6.2f}%, Beta={step.ai_portfolio_beta:.2f}) | "
                f"Unprotected: ${step.unprotected_equity:>9,.2f} ({step.unprotected_return_pct:+6.2f}%) | "
                f"SPY: ${step.benchmark_equity:>9,.2f} ({step.benchmark_return_pct:+6.2f}%)"
            )


def run_all_what_if_tests():
    holdings = [
        Holding(ticker="NVDA", shares=35, avg_cost=115.0),
        Holding(ticker="AAPL", shares=15, avg_cost=210.0),
        Holding(ticker="MSFT", shares=8, avg_cost=415.0),
        Holding(ticker="TSLA", shares=10, avg_cost=220.0),
        Holding(ticker="JNJ", shares=12, avg_cost=155.0),
    ]
    engine = PortfolioQuantEngine(holdings=holdings, cash=1000.0)
    engine.refresh_market_data(period="6mo")

    simulator = MarketCrashSimulator(engine=engine)

    # 1. Single-Stock Crash (NVDA -28%)
    res_single = simulator.run_preset_scenario("single_stock_nvda_crash")
    print_simulation_report(res_single)
    assert res_single.ai_final_equity > res_single.unprotected_final_equity

    # 2. Multi-Stock Tech Bubble Burst
    res_multi = simulator.run_preset_scenario("tech_sector_meltdown")
    print_simulation_report(res_multi)
    assert res_multi.ai_final_equity > res_multi.unprotected_final_equity
    assert res_multi.ai_final_equity > res_multi.benchmark_final_equity

    # 3. Systemic Market Crash (SPY -22%, Beta-Propagated + Short Hedge)
    res_sys = simulator.run_preset_scenario("systemic_2008_style_crash")
    print_simulation_report(res_sys)
    assert res_sys.ai_final_equity > res_sys.unprotected_final_equity
    assert res_sys.ai_final_equity > res_sys.benchmark_final_equity

    # 4. Real Historical Market Crash Replay (Summer 2024 Tech & Yen-Carry Unwind)
    res_hist = simulator.replay_historical_crash_window(
        start_date="2024-07-10",
        end_date="2024-08-08",
    )
    print_simulation_report(res_hist)
    assert res_hist.ai_final_equity > res_hist.unprotected_final_equity

    print("\n" + "=" * 82)
    print("ALL 4 WHAT-IF CRASH & HISTORICAL REPLAY ROBUSTNESS TESTS PASSED!")
    print("=" * 82)


if __name__ == "__main__":
    run_all_what_if_tests()
