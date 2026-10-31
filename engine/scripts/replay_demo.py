"""Run the demo replay and write results for the dashboard.

Usage (from the engine/ folder):
    uv run --project . python scripts/replay_demo.py [--start 2025-01-02] [--end 2025-03-14]

Writes data/replay_result.json with daily NAV per strategy, a summary table and the event log.
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

from guardian.data import DATA_DIR, fetch_prices  # noqa: E402
from guardian.config import policy_from_limits  # noqa: E402
from guardian.simulator import replay  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-01-02")
    ap.add_argument("--end", default="2025-03-14")
    ap.add_argument("--max-drawdown", type=float, default=0.10, help="user limit, e.g. 0.10 = never fall more than 10%%")
    ap.add_argument("--max-daily-loss", type=float, default=0.02, help="user limit, e.g. 0.02 = lose at most 2%% in a day")
    args = ap.parse_args()

    frames = fetch_prices("2023-10-01", "2025-03-15", cache_name="replay_2025q1")
    policy = policy_from_limits(args.max_drawdown, args.max_daily_loss)
    res = replay(frames, args.start, args.end, policy=policy)

    summary = res.summary()
    print(summary.round(4).to_string())
    for e in res.events:
        if e["kind"] in ("trigger", "emergency", "re-risk", "exit"):
            print(e["date"], e["strategy"], e["kind"], e.get("reasons", e.get("detail", "")), "chosen=" + str(e.get("chosen")))

    out = {
        "start": args.start,
        "end": args.end,
        "simulated": True,
        "limits": {"max_drawdown": args.max_drawdown, "max_daily_loss": args.max_daily_loss},
        "thresholds": {"rotation_loss": policy.rotation_loss, "emergency_loss": policy.emergency_loss, "shock_day": policy.shock_portfolio_return, "daily_var_limit": policy.daily_var_limit, "rerisk_loss": policy.rerisk_loss},
        "nav": {k: {str(d.date()): round(float(v), 2) for d, v in s.items()} for k, s in res.nav.items()},
        "summary": json.loads(summary.to_json(orient="index")),
        "events": res.events,
    }
    path = Path(DATA_DIR) / "replay_result.json"
    path.write_text(json.dumps(out, indent=2, default=str))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
