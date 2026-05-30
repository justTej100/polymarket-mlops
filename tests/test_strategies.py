"""Strategy and data client tests."""

import time

import pytest

from src.data.binance_ws import MockBinanceWSClient
from src.data.polymarket_clob import MarketInfo, MockPolymarketClobClient
from src.system_a.strategy_1_penny_buy import Strategy1PennyBuy
from src.system_a.strategy_2_sniper import Strategy2Sniper
from src.system_a.strategy_3_dual_reversion import Strategy3DualReversion
from src.system_a.strategy_4_preorder import Strategy4Preorder
from src.system_a.strategy_5_cross_market import Strategy5CrossMarket
from src.system_a.strategy_6_martingale import Strategy6Martingale
from src.system_a.strategy_7_fibonacci import Strategy7Fibonacci
from src.system_a.strategy_8_momentum import Strategy8Momentum
from src.system_a.strategy_9_dump_hedge import Strategy9DumpHedge
from src.system_c.wallet_ranker import WalletRanker


def _demo_market(**kwargs) -> MarketInfo:
    base = {
        "market_id": "btc-5m-demo",
        "slug": "btc-5m-updown-demo",
        "asset": "BTC",
        "strike": 67400.0,
        "end_time_ms": int(time.time() * 1000) + 120_000,
        "up_token_id": "up-token",
        "down_token_id": "down-token",
        "next_market_id": "btc-5m-next",
    }
    base.update(kwargs)
    return MarketInfo(**base)


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
    market = _demo_market(end_time_ms=int(time.time() * 1000) + 30_000)
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
    market = _demo_market()
    signal = strat.evaluate(market)
    assert signal is not None
    assert signal["side"] == "UP"


def test_strategy1_buys_cheap_sides():
    clob = MockPolymarketClobClient()
    clob.set_book("up-token", bid=0.01, ask=0.02)
    clob.set_book("down-token", bid=0.01, ask=0.03)
    strat = Strategy1PennyBuy(use_mock=True)
    strat.clob = clob
    strat.entry_delay = 0
    market = _demo_market(end_time_ms=int(time.time() * 1000) + 180_000)
    signals = strat.evaluate_signals(market)
    assert len(signals) == 2
    assert all(s["price"] <= 0.03 for s in signals)


def test_strategy3_dual_reversion():
    clob = MockPolymarketClobClient()
    clob.set_book("up-token", bid=0.42, ask=0.43)
    clob.set_book("down-token", bid=0.43, ask=0.44)
    strat = Strategy3DualReversion(use_mock=True)
    strat.clob = clob
    market = _demo_market(end_time_ms=int(time.time() * 1000) + 180_000)
    signals = strat.evaluate_signals(market)
    assert len(signals) == 2
    assert signals[0]["side"] == "UP"
    assert signals[1]["side"] == "DOWN"


def test_strategy4_preorder_when_stable():
    clob = MockPolymarketClobClient()
    clob.set_book("up-token", bid=0.50, ask=0.52)
    clob.set_book("down-token", bid=0.47, ask=0.48)
    strat = Strategy4Preorder(use_mock=True)
    strat.clob = clob
    strat.entry_window = 300
    market = _demo_market(end_time_ms=int(time.time() * 1000) + 60_000)
    signals = strat.evaluate_signals(market)
    assert len(signals) == 2
    assert signals[0]["market_id"] == "btc-5m-next"


def test_strategy5_cross_market_lag():
    clob = MockPolymarketClobClient()
    clob.markets = [
        _demo_market(asset="BTC"),
        MarketInfo(
            market_id="eth-5m-demo",
            slug="eth-5m-demo",
            asset="ETH",
            strike=3400.0,
            end_time_ms=int(time.time() * 1000) + 120_000,
            up_token_id="eth-up",
            down_token_id="eth-down",
        ),
    ]
    clob.set_book("eth-up", bid=0.48, ask=0.51)
    binance = MockBinanceWSClient()
    t0 = int(time.time() * 1000)
    binance.push_tick("BTC", 67000.0, t0)
    binance.push_tick("BTC", 67200.0, t0 + 5000)
    strat = Strategy5CrossMarket(use_mock=True)
    strat.clob = clob
    strat.binance = binance
    strat.lag_assets = ["ETH"]
    signals = strat.evaluate_signals(_demo_market())
    assert len(signals) >= 1
    assert signals[0]["market_id"] == "eth-5m-demo"


def test_strategy6_martingale_entry():
    clob = MockPolymarketClobClient()
    clob.set_book("up-token", bid=0.43, ask=0.45)
    binance = MockBinanceWSClient()
    binance.push_tick("BTC", 67400.0)
    binance.push_tick("BTC", 67405.0)
    strat = Strategy6Martingale(use_mock=True)
    strat.clob = clob
    strat.binance = binance
    strat.mode = "martingale"
    signal = strat.evaluate(_demo_market())
    assert signal is not None
    assert signal["side"] == "UP"


def test_strategy7_fibonacci_after_observe():
    clob = MockPolymarketClobClient()
    clob.set_book("up-token", bid=0.45, ask=0.46)
    strat = Strategy7Fibonacci(use_mock=True)
    strat.clob = clob
    strat.observe_seconds = 0
    market = _demo_market(end_time_ms=int(time.time() * 1000) + 180_000)
    strat._swing[market.market_id] = (0.42, 0.58)
    signals = strat.evaluate_signals(market)
    assert len(signals) >= 1


def test_strategy8_momentum_scores():
    clob = MockPolymarketClobClient()
    strat = Strategy8Momentum(use_mock=True)
    strat.clob = clob
    strat.min_score = 3
    strat.macd_slow = 3
    strat.rsi_period = 5
    prices = [0.45 + i * 0.01 for i in range(20)]
    for p in prices:
        clob.set_book("up-token", bid=p - 0.01, ask=p)
        strat._record_price(_demo_market())
    score, price = strat._score()
    assert price is not None
    assert score >= 0


def test_run_all_implemented_all_nine():
    from src.system_a import run_all

    assert run_all.IMPLEMENTED == set(range(1, 10))


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
