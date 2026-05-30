"""Strategy 4 — Pre-Order next market window at mid prices.

Entry logic:
  - In last STRAT4_ENTRY_WINDOW_SECONDS_BEFORE_CLOSE of current market
  - Current market "stable": both sides between STRAT4_STABLE_MIN and MAX
  - Place limit bids at STRAT4_PRE_ORDER_PRICE on NEXT period UP and DOWN
  - Fires once per next_market_id (deduped via _preordered set)

Connections: ``BaseStrategy`` → ``POST /signal/a/4`` on ``next_market_id``.

Environment: STRAT4_CURRENT_MARKET_STABLE_MIN/MAX, STRAT4_PRE_ORDER_PRICE,
    STRAT4_ENTRY_WINDOW_SECONDS_BEFORE_CLOSE, STRAT4_SHARES_PER_SIDE, STRAT4_MAX_NOTIONAL_USD.
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


class Strategy4Preorder(BaseStrategy):
    """Next-window paired pre-orders (strategy_id=4)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=4,
                max_notional_usd=float(os.getenv("STRAT4_MAX_NOTIONAL_USD", "100")),
            ),
            use_mock=use_mock,
        )
        self.stable_min = float(os.getenv("STRAT4_CURRENT_MARKET_STABLE_MIN", "0.35"))
        self.stable_max = float(os.getenv("STRAT4_CURRENT_MARKET_STABLE_MAX", "0.65"))
        self.pre_order_price = float(os.getenv("STRAT4_PRE_ORDER_PRICE", "0.45"))
        self.entry_window = float(os.getenv("STRAT4_ENTRY_WINDOW_SECONDS_BEFORE_CLOSE", "120"))
        self.shares_per_side = float(os.getenv("STRAT4_SHARES_PER_SIDE", "100"))
        self._preordered: set[str] = set()

    @property
    def name(self) -> str:
        return "strategy_4_preorder"

    def _current_stable(self, market: MarketInfo) -> bool:
        if not market.up_token_id or not market.down_token_id:
            return False
        up_ask = self.clob.get_order_book(market.up_token_id).best_ask
        down_ask = self.clob.get_order_book(market.down_token_id).best_ask
        if up_ask is None or down_ask is None:
            return False
        up_ok = self.stable_min <= up_ask <= self.stable_max
        down_ok = self.stable_min <= down_ask <= self.stable_max
        return up_ok and down_ok

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        remaining = self.time_remaining_seconds(market)
        if remaining is None or remaining > self.entry_window:
            return []
        if not self._current_stable(market):
            return []

        next_id = market.next_market_id or f"{market.market_id}-next"
        if next_id in self._preordered:
            return []
        self._preordered.add(next_id)

        notional = self.pre_order_price * self.shares_per_side
        if notional * 2 > self.config.max_notional_usd:
            self.shares_per_side = self.config.max_notional_usd / (2 * self.pre_order_price)

        return [
            {
                "market_id": next_id,
                "action": "BUY",
                "side": "UP",
                "price": self.pre_order_price,
                "shares": self.shares_per_side,
                "confidence": 0.7,
            },
            {
                "market_id": next_id,
                "action": "BUY",
                "side": "DOWN",
                "price": self.pre_order_price,
                "shares": self.shares_per_side,
                "confidence": 0.7,
            },
        ]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy4Preorder().run()


if __name__ == "__main__":
    main()
