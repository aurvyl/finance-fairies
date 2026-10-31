from quant_backend import Holding, PortfolioQuantEngine, PortfolioHedgingEngine


def print_hedge_plan(plan):
    print("\n" + "=" * 84)
    print(f"USER CHOICE : {plan.mode_label}  |  TIME WINDOW: {plan.duration_label}")
    print("=" * 84)
    print(f"Portfolio Equity       : ${plan.total_portfolio_equity:>10,.2f}")
    print(f"Portfolio Beta Shift   : {plan.current_portfolio_beta:.2f}  --->  {plan.post_hedge_effective_beta:.2f} (Post-Hedge Effective Beta)")
    print(f"Chosen Instrument      : {plan.hedge_ticker} — {plan.hedge_instrument_name} ({plan.hedge_leverage:+.0f}x)")
    print(
        f"Order to Execute       : BUY {plan.shares_to_buy} shares of {plan.hedge_ticker} @ ${plan.hedge_live_price:.2f} "
        f"= ${plan.cash_required_dollars:,.2f} ({plan.pct_of_portfolio_cash_used:.1f}% of portfolio)"
    )
    print(
        f"{plan.duration_trading_days}-Day 95% Crash VaR   : Unhedged -${plan.unhedged_t_day_var_95_dollars:,.2f}  --->  "
        f"Hedged -${plan.hedged_t_day_var_95_dollars:,.2f} (Saves ${plan.var_risk_reduction_dollars:,.2f} in tail risk)"
    )
    print(
        f"Time-Window Exit Rules : Auto-Unwind on {plan.auto_unwind_date} | "
        f"Take-Profit @ ${plan.hedge_take_profit_price:.2f} | Stop-Loss @ ${plan.hedge_stop_loss_price:.2f}"
    )
    print(
        f"Est. {plan.duration_trading_days}-Day Holding Cost: ${plan.estimated_holding_cost_dollars:.2f} "
        f"({plan.estimated_holding_cost_pct:.3f}% of hedge notional)"
    )
    print("-" * 84)
    print(f"AI Summary: \"{plan.agent_summary}\"")
    print("-" * 84)
    print(
        f"{'Market Move':<14} | {'Unhedged P&L':>15} | {'Hedge Payout':>15} | "
        f"{'Net Hedged P&L':>16} | {'Net Return %':>12}"
    )
    print("-" * 84)
    for row in plan.payoff_table:
        print(
            f"{row.market_move_pct:>+10.1f}%   | "
            f"${row.unhedged_pnl_dollars:>+14,.2f} | "
            f"${row.hedge_payout_dollars:>+14,.2f} | "
            f"${row.net_hedged_pnl_dollars:>+15,.2f} | "
            f"{row.net_hedged_return_pct:>+11.2f}%"
        )


def run_hedging_tests():
    holdings = [
        Holding(ticker="NVDA", shares=35, avg_cost=115.0),
        Holding(ticker="AAPL", shares=15, avg_cost=210.0),
        Holding(ticker="MSFT", shares=8, avg_cost=415.0),
        Holding(ticker="TSLA", shares=10, avg_cost=220.0),
        Holding(ticker="JNJ", shares=12, avg_cost=155.0),
    ]
    engine = PortfolioQuantEngine(holdings=holdings, cash=1000.0)
    engine.refresh_market_data(period="6mo")

    hedger = PortfolioHedgingEngine(engine=engine)

    # 1. Light Hedge (25%) for a 48-Hour Event (2 Trading Days -> auto-selects -3x SPXS for capital efficiency)
    plan_light = hedger.build_hedge_plan(coverage_choice="LIGHT", time_choice="48H_EVENT")
    print_hedge_plan(plan_light)

    # 2. Balanced Hedge (50%) for 1 Week (5 Trading Days -> -3x SPXS)
    plan_balanced = hedger.build_hedge_plan(coverage_choice="BALANCED", time_choice="1_WEEK")
    print_hedge_plan(plan_balanced)

    # 3. Full-Lock Hedge (100%) for 1 Month Vacation (21 Trading Days -> auto-selects -1x SH to avoid leverage decay)
    plan_full = hedger.build_hedge_plan(coverage_choice="FULL_LOCK", time_choice="1_MONTH")
    print_hedge_plan(plan_full)

    # 4. Custom User Slider Choice: 75% Coverage for 10 Trading Days using -3x Nasdaq Inverse (SQQQ)
    plan_custom = hedger.build_hedge_plan(coverage_choice=75.0, time_choice=10, hedge_ticker="SQQQ")
    print_hedge_plan(plan_custom)

    # Verify matrix generation for Frontend UI
    matrix = hedger.get_interactive_choice_matrix()
    assert len(matrix["plans"]) == 3
    print("\n" + "=" * 84)
    print("SUCCESS: All User-Choice Hedging Plans (Percentage x Time Horizon) verified!")
    print("=" * 84)


if __name__ == "__main__":
    run_hedging_tests()
