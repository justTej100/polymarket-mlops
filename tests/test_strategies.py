"""Strategy and data client tests."""

import time

import pytest

from src.data.binance_ws import MockBinanceWSClient
from src.data.polymarket_clob import MockPolymarketClobClient, OrderBook, OrderBookLevel
from src.system_a.strategy_2_sniper import Strategy2Sniper
from src.system_a.strategy_9_dump_hedge import Strategy9DumpHedge
from src.system_c.wallet_ranker import WalletRanker


def test_mock_binance_pct_change():
    client = MockBinanceWSClient()
    t0 = int(time.time() * 1000)
    client.push_tick("BTC", 100.0, t0)
    client.push_tick("BTC", 99.0, t0 + 5000)
    change = client.pct_change("BTC", 10)
    assert change == pytest.approx(-0.01)


def test_strategy2_fires_near_expiry():
    clob = MockPolymarketClobClient()
    binance = MockBinanceWSClient()
    clob.set_book("up-token", bid=0.98, ask=0.99)
    strat = Strategy2Sniper(use_mock=True)
    strat.clob = clob
    strat.binance = binance
    binance.push_tick("BTC", 67500.0)
    market = clob.list_active_markets()[0]
    market.strike = 67400.0
    market.end_time_ms = int(time.time() * 1000) + 30_000
    signal = strat.evaluate(market)
    assert signal is not None
    assert signal["side"] == "UP"
    assert signal["price"] == 0.99


def test_strategy9_detects_dump():
    clob = MockPolymarketClobClient()
    binance = MockBinanceWSClient()
    clob.set_book("up-token", bid=0.08, ask=0.10)
    clob.set_book("down-token", bid=0.84, ask=0.86)
    strat = Strategy9DumpHedge(use_mock=True)
    strat.clob = clob
    strat.binance = binance
    t0 = int(time.time() * 1000)
    binance.push_tick("BTC", 67500.0, t0)
    binance.push_tick("BTC", 67250.0, t0 + 8000)
    market = clob.list_active_markets()[0]
    signal = strat.evaluate(market)
    assert signal is not None
    assert signal["side"] == "UP"


def test_wallet_ranker_sorts():
    clob = MockPolymarketClobClient()
    clob.wallets = [
        {"address": "0xaaa", "pnl_30d": 500},
        {"address": "0xbbb", "pnl_30d": 900},
    ]
    ranker = WalletRanker(clob=clob, use_mock=True)
    top = ranker.fetch_top(2)
    assert top[0].address == "0xbbb"
    assert top[0].pnl_30d == 900
