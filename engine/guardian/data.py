"""Download and cache daily prices (yfinance, split/dividend adjusted)."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pandas as pd
import yfinance as yf

from .config import ALL_TICKERS, BENCHMARK

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _cache_dir() -> Path:
    """engine/data/ when writable; otherwise a temp dir (read-only serverless filesystems)."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if os.access(DATA_DIR, os.W_OK):
            return DATA_DIR
    except OSError:
        pass
    tmp = Path(tempfile.gettempdir()) / "guardian-data"
    tmp.mkdir(parents=True, exist_ok=True)
    return tmp


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
    for folder in dict.fromkeys([DATA_DIR, _cache_dir()]):
        found = {k: folder / f"{cache_name}_{k}.parquet" for k in ("open", "close", "volume")}
        if all(p.exists() for p in found.values()):
            return {k: pd.read_parquet(p) for k, p in found.items()}
    paths = {k: _cache_dir() / f"{cache_name}_{k}.parquet" for k in ("open", "close", "volume")}

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
    # Crypto trades every day; keep exchange sessions only so every asset shares one calendar.
    # A weekend crypto move then shows up in Monday's return.
    sessions = frames["close"][BENCHMARK].dropna().index if BENCHMARK in tickers else frames["close"].index
    for k, df in frames.items():
        df = df.loc[sessions].sort_index()
        df.index = pd.to_datetime(df.index).tz_localize(None)
        if k != "volume":
            df = df.ffill(limit=3)
        frames[k] = df
        df.to_parquet(paths[k])
    return frames


def missing_report(frames: dict[str, pd.DataFrame]) -> dict[str, int]:
    """Count missing closes per ticker so gaps are visible before a replay."""
    close = frames["close"]
    return {t: int(close[t].isna().sum()) for t in close.columns}
