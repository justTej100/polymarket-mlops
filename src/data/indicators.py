"""Technical indicators — pure functions, no I/O.

Functions:
  - ``macd(prices)`` — fast/slow EMA crossover + histogram
  - ``rsi(prices)`` — relative strength index (0–100)
  - ``vwap(prices, volumes)`` — volume-weighted average price
  - ``book_imbalance(bid_size, ask_size)`` — order book skew (-1 to +1)

Used by: feature_pipeline (Redis features), strategy_8_momentum.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def ema(series: pd.Series, span: int) -> pd.Series:
    """Exponential moving average with the given span."""
    return series.ewm(span=span, adjust=False).mean()


def macd(
    prices: pd.Series,
    fast: int = 3,
    slow: int = 8,
    signal: int = 3,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return MACD line, signal line, and histogram."""
    fast_ema = ema(prices, fast)
    slow_ema = ema(prices, slow)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """Relative strength index (0–100) using Wilder-style EMA smoothing."""
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def vwap(prices: pd.Series, volumes: pd.Series) -> pd.Series:
    """Cumulative volume-weighted average price series."""
    cum_vol = volumes.cumsum()
    cum_pv = (prices * volumes).cumsum()
    return cum_pv / cum_vol.replace(0, np.nan)


def book_imbalance(bid_size: float, ask_size: float) -> float:
    """Order book skew in [-1, 1]: positive means more bid size than ask."""
    total = bid_size + ask_size
    if total <= 0:
        return 0.0
    return (bid_size - ask_size) / total
