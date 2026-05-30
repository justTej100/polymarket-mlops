"""Strategy 3 — Low-Side Dual Reversion (buy both sides when compressed).

Entry logic:
  - Both UP and DOWN asks between STRAT3_MIN and STRAT3_MAX (e.g. 30–48c)
  - Combined cost <= STRAT3_MAX_COMBINED_COST (locked edge vs $1 payout)
  - At least STRAT3_MIN_TIME_REMAINING_SECONDS left
  - Sends two signals: one UP leg, one DOWN leg

Connections: ``BaseStrategy`` dual-leg → ``POST /signal/a/3`` (two orders per cycle).

Environment: STRAT3_MAX_ASK_EITHER_SIDE, STRAT3_MIN_ASK_EITHER_SIDE,
    STRAT3_MAX_COMBINED_COST, STRAT3_MIN_TIME_REMAINING_SECONDS,
    STRAT3_MAX_NOTIONAL_PER_SIDE_USD.
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


class Strategy3DualReversion(BaseStrategy):
    """Compressed dual-side arb (strategy_id=3)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=3,
                max_notional_usd=float(os.getenv("STRAT3_MAX_NOTIONAL_PER_SIDE_USD", "100")),
            ),
            use_mock=use_mock,
        )
        self.max_ask = float(os.getenv("STRAT3_MAX_ASK_EITHER_SIDE", "0.48"))
        self.min_ask = float(os.getenv("STRAT3_MIN_ASK_EITHER_SIDE", "0.30"))
        self.max_combined = float(os.getenv("STRAT3_MAX_COMBINED_COST", "0.98"))
        self.min_remaining = float(os.getenv("STRAT3_MIN_TIME_REMAINING_SECONDS", "120"))

    @property
    def name(self) -> str:
        return "strategy_3_dual_reversion"

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        remaining = self.time_remaining_seconds(market)
        if remaining is None or remaining < self.min_remaining:
            return []
        if not market.up_token_id or not market.down_token_id:
            return []

        up_ask = self.clob.get_order_book(market.up_token_id).best_ask
        down_ask = self.clob.get_order_book(market.down_token_id).best_ask
        if up_ask is None or down_ask is None:
            return []

        asks = [up_ask, down_ask]
        if max(asks) > self.max_ask or min(asks) < self.min_ask:
            return []
        if up_ask + down_ask > self.max_combined:
            return []

        edge = 1.0 - (up_ask + down_ask)
        shares = min(
            self.config.max_notional_usd / up_ask,
            self.config.max_notional_usd / down_ask,
        )
        if shares <= 0:
            return []

        confidence = min(edge * 5, 1.0)
        return [
            {
                "market_id": market.market_id,
                "action": "BUY",
                "side": "UP",
                "price": up_ask,
                "shares": shares,
                "confidence": confidence,
            },
            {
                "market_id": market.market_id,
                "action": "BUY",
                "side": "DOWN",
                "price": down_ask,
                "shares": shares,
                "confidence": confidence,
            },
        ]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy3DualReversion().run()


if __name__ == "__main__":
    main()
