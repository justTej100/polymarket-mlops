"""Real-time feature pipeline: Binance + Polymarket → Redis.

Long-running process started by supervisor. Each poll cycle:
  1. Read CLOB order books for BTC/ETH/SOL/XRP
  2. Build 5-second OHLC bars from mid prices
  3. Compute MACD, RSI, VWAP → ``pm:features:{asset}``
  4. Write spot ticks → ``pm:spot:{asset}``, book stats → ``pm:book:{asset}``

Environment:
  - ``REDIS_URL``, ``FEATURE_PIPELINE_MOCK`` (use mock CLOB), ``FEATURE_BAR_SECONDS``
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from collections import defaultdict, deque

import pandas as pd
import redis
from dotenv import load_dotenv

from src.data.binance_ws import ASSETS, BinanceWSClient, PriceTick
from src.data.indicators import book_imbalance, macd, rsi, vwap
from src.data.polymarket_clob import HttpPolymarketClobClient, MockPolymarketClobClient

load_dotenv()
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
BAR_SECONDS = int(os.getenv("FEATURE_BAR_SECONDS", "5"))


def redis_key(prefix: str, asset: str, suffix: str = "") -> str:
    """Build canonical Redis hash key, e.g. ``pm:features:btc``."""
    base = f"pm:{prefix}:{asset.lower()}"
    return f"{base}:{suffix}" if suffix else base


class FeaturePipeline:
    """Binance ticks + CLOB books → Redis ``pm:spot``, ``pm:book``, ``pm:features`` hashes."""

    def __init__(
        self,
        redis_url: str = REDIS_URL,
        use_mock_clob: bool = False,
    ) -> None:
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.binance = BinanceWSClient(on_tick=self._on_tick)
        self.clob = (
            MockPolymarketClobClient()
            if use_mock_clob
            else HttpPolymarketClobClient()
        )
        self._bars: dict[str, deque[dict]] = defaultdict(lambda: deque(maxlen=200))
        self._running = False

    def _on_tick(self, tick: PriceTick) -> None:
        key = redis_key("spot", tick.asset)
        self.redis.hset(
            key,
            mapping={
                "price": f"{tick.price:.8f}",
                "ts_ms": str(tick.timestamp_ms),
            },
        )
        self.redis.expire(key, 300)

    def _update_token_bar(self, asset: str, price: float, volume: float = 1.0) -> None:
        bars = self._bars[asset]
        now = int(time.time())
        bucket = now - (now % BAR_SECONDS)
        if bars and bars[-1]["bucket"] == bucket:
            bar = bars[-1]
            bar["close"] = price
            bar["high"] = max(bar["high"], price)
            bar["low"] = min(bar["low"], price)
            bar["volume"] += volume
        else:
            bars.append(
                {
                    "bucket": bucket,
                    "open": price,
                    "high": price,
                    "low": price,
                    "close": price,
                    "volume": volume,
                }
            )

    def _compute_and_store_indicators(self, asset: str) -> None:
        bars = self._bars[asset]
        if len(bars) < 5:
            return
        df = pd.DataFrame(list(bars))
        closes = df["close"]
        volumes = df["volume"]
        macd_line, signal_line, histogram = macd(closes)
        rsi_vals = rsi(closes)
        vwap_vals = vwap(closes, volumes)
        key = redis_key("features", asset)
        self.redis.hset(
            key,
            mapping={
                "macd": f"{macd_line.iloc[-1]:.6f}",
                "macd_signal": f"{signal_line.iloc[-1]:.6f}",
                "macd_hist": f"{histogram.iloc[-1]:.6f}",
                "rsi": f"{rsi_vals.iloc[-1]:.4f}",
                "vwap": f"{vwap_vals.iloc[-1]:.6f}",
                "close": f"{closes.iloc[-1]:.6f}",
                "updated_ms": str(int(time.time() * 1000)),
            },
        )
        self.redis.expire(key, 600)

    def _update_book_features(self, asset: str) -> None:
        markets = self.clob.list_active_markets(asset=asset)
        if not markets:
            return
        market = markets[0]
        token_id = market.up_token_id or market.market_id
        book = self.clob.get_order_book(token_id)
        imbalance = book_imbalance(book.bid_size, book.ask_size)
        mid = None
        if book.best_bid is not None and book.best_ask is not None:
            mid = (book.best_bid + book.best_ask) / 2
            self._update_token_bar(asset, mid)
        key = redis_key("book", asset)
        mapping = {
            "imbalance": f"{imbalance:.6f}",
            "bid_size": f"{book.bid_size:.2f}",
            "ask_size": f"{book.ask_size:.2f}",
            "updated_ms": str(book.timestamp_ms),
        }
        if book.best_bid is not None:
            mapping["best_bid"] = f"{book.best_bid:.4f}"
        if book.best_ask is not None:
            mapping["best_ask"] = f"{book.best_ask:.4f}"
        if mid is not None:
            mapping["mid"] = f"{mid:.4f}"
        self.redis.hset(key, mapping=mapping)
        self.redis.expire(key, 120)
        self._compute_and_store_indicators(asset)

    def run_once(self) -> None:
        for asset in ASSETS:
            try:
                self._update_book_features(asset)
            except Exception as exc:
                logger.warning("Book feature update failed for %s: %s", asset, exc)

    def run(self, poll_interval: float = 2.0) -> None:
        self._running = True
        self.binance.start()
        logger.info("Feature pipeline running (Redis=%s)", REDIS_URL)
        while self._running:
            self.run_once()
            time.sleep(poll_interval)

    def stop(self) -> None:
        self._running = False
        self.binance.stop()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    use_mock = os.getenv("FEATURE_PIPELINE_MOCK", "false").lower() == "true"
    pipeline = FeaturePipeline(use_mock_clob=use_mock)

    def _shutdown(_signum, _frame) -> None:
        pipeline.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    pipeline.run()


if __name__ == "__main__":
    main()
