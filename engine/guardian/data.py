"""Download and cache daily prices (yfinance, split/dividend adjusted)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import yfinance as yf

from .config import ALL_TICKERS

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def fetch_prices(
    start: str,
    end: str,
    tickers: list[str] | None = None,
    cache_name: str | None = None,
) -> dict[str, pd.DataFrame]:
    """Return {"open", "close", "volume"} frames (index = date, columns = tickers).

    Results are cached as Parquet under engine/data/ so replays run offline.
    """
    tickers = tickers or ALL_TICKERS
    cache_name = cache_name or f"prices_{start}_{end}"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    paths = {k: DATA_DIR / f"{cache_name}_{k}.parquet" for k in ("open", "close", "volume")}
    if all(p.exists() for p in paths.values()):
        return {k: pd.read_parquet(p) for k, p in paths.items()}

    raw = yf.download(
        tickers,
        start=start,
        end=end,
        auto_adjust=True,
        progress=False,
        group_by="column",
        threads=True,
    )
    if raw is None or raw.empty:
        raise RuntimeError(f"No price data returned for {start}..{end}")

    frames = {
        "open": raw["Open"][tickers],
        "close": raw["Close"][tickers],
        "volume": raw["Volume"][tickers],
    }
    for k, df in frames.items():
        df = df.sort_index()
        df.index = pd.to_datetime(df.index).tz_localize(None)
        frames[k] = df
        df.to_parquet(paths[k])
    return frames


def missing_report(frames: dict[str, pd.DataFrame]) -> dict[str, int]:
    """Count missing closes per ticker so gaps are visible before a replay."""
    close = frames["close"]
    return {t: int(close[t].isna().sum()) for t in close.columns}
