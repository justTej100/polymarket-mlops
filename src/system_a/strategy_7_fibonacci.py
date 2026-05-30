"""Strategy 7 — Fibonacci retracement entries on token price swing.

Entry logic:
  - Observe swing high/low for STRAT7_SWING_OBSERVE_SECONDS after market open
  - Compute fib retracement levels (23.6%, 38.2%, 50%, 61.8%) from swing range
  - Place staged bids when price reaches each level (size scales down per level)
  - Invalidate if price breaks below swing low minus STRAT7_INVALIDATION_BUFFER

Connections: CLOB UP token swing tracking → ``POST /signal/a/7`` (staged levels).

Environment: STRAT7_FIB_LEVELS, STRAT7_SWING_OBSERVE_SECONDS, STRAT7_INVALIDATION_BUFFER,
    STRAT7_MIN_TIME_REMAINING_SECONDS, STRAT7_SIZE_LARGEST_LEVEL, STRAT7_SIZE_SCALE_FACTOR,
    STRAT7_MAX_NOTIONAL_USD.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from dotenv import load_dotenv

from src.data.polymarket_clob import MarketInfo
from src.system_a.base_strategy import BaseStrategy, StrategyConfig

load_dotenv()
logger = logging.getLogger(__name__)


def _parse_levels(raw: str) -> list[float]:
    return [float(x.strip()) for x in raw.split(",") if x.strip()]


class Strategy7Fibonacci(BaseStrategy):
    """Staged fib retracement bids on UP token swing (strategy_id=7)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=7,
                max_notional_usd=float(os.getenv("STRAT7_MAX_NOTIONAL_USD", "120")),
            ),
            use_mock=use_mock,
        )
        self.observe_seconds = float(os.getenv("STRAT7_SWING_OBSERVE_SECONDS", "90"))
        self.fib_levels = _parse_levels(os.getenv("STRAT7_FIB_LEVELS", "0.236,0.382,0.500,0.618"))
        self.invalidation_buffer = float(os.getenv("STRAT7_INVALIDATION_BUFFER", "0.02"))
        self.min_remaining = float(os.getenv("STRAT7_MIN_TIME_REMAINING_SECONDS", "90"))
        self.base_size = float(os.getenv("STRAT7_SIZE_LARGEST_LEVEL", "100"))
        self.scale = float(os.getenv("STRAT7_SIZE_SCALE_FACTOR", "0.75"))
        self._swing: dict[str, tuple[float, float]] = {}
        self._filled: set[str] = set()

    @property
    def name(self) -> str:
        return "strategy_7_fibonacci"

    def _update_swing(self, market: MarketInfo, price: float) -> None:
        low, high = self._swing.get(market.market_id, (price, price))
        self._swing[market.market_id] = (min(low, price), max(high, price))

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        remaining = self.time_remaining_seconds(market)
        age = self.market_age_seconds(market)
        if remaining is None or age is None or remaining < self.min_remaining:
            return []
        if not market.up_token_id:
            return []

        mid = self.clob.get_order_book(market.up_token_id)
        price = mid.best_ask or mid.best_bid
        if price is None:
            return []

        self._update_swing(market, price)
        if age < self.observe_seconds:
            return []

        swing_low, swing_high = self._swing[market.market_id]
        if price < swing_low - self.invalidation_buffer:
            return []

        span = swing_high - swing_low
        if span <= 0:
            return []

        signals: list[dict[str, Any]] = []
        size = self.base_size
        for level in self.fib_levels:
            target = swing_low + level * span
            key = f"{market.market_id}:{level}"
            if key in self._filled:
                size *= self.scale
                continue
            if abs(price - target) <= 0.02 or price <= target:
                shares = min(size, self.config.max_notional_usd / max(price, 0.01))
                if shares <= 0:
                    continue
                self._filled.add(key)
                signals.append(
                    {
                        "market_id": market.market_id,
                        "action": "BUY",
                        "side": "UP",
                        "price": price,
                        "shares": shares,
                        "confidence": 0.65,
                    }
                )
            size *= self.scale
        return signals


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy7Fibonacci().run()


if __name__ == "__main__":
    main()
