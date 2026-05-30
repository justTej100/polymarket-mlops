"""Indicator math tests."""

import pandas as pd
import pytest

from src.data.indicators import book_imbalance, macd, rsi, vwap


@pytest.fixture
def price_series():
    return pd.Series([0.45, 0.46, 0.44, 0.47, 0.48, 0.50, 0.49, 0.51, 0.52, 0.50])


def test_macd_returns_three_series(price_series):
    line, signal, hist = macd(price_series)
    assert len(line) == len(price_series)
    assert len(signal) == len(price_series)
    assert len(hist) == len(price_series)
    assert abs(hist.iloc[-1] - (line.iloc[-1] - signal.iloc[-1])) < 1e-9


def test_rsi_bounded(price_series):
    values = rsi(price_series, period=5)
    valid = values.dropna()
    assert (valid >= 0).all()
    assert (valid <= 100).all()


def test_vwap_weighted():
    prices = pd.Series([0.4, 0.5, 0.6])
    volumes = pd.Series([1, 2, 1])
    result = vwap(prices, volumes)
    expected = (0.4 * 1 + 0.5 * 2 + 0.6 * 1) / 4
    assert abs(result.iloc[-1] - expected) < 1e-9


def test_book_imbalance_balanced():
    assert book_imbalance(100, 100) == 0.0


def test_book_imbalance_bid_heavy():
    assert book_imbalance(150, 50) == pytest.approx(0.5)


def test_book_imbalance_empty():
    assert book_imbalance(0, 0) == 0.0
