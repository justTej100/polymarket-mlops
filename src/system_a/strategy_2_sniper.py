"""Strategy 2 — 99c Sniper (near-resolution strike).

Entry logic:
  - Time remaining <= STRAT2_MAX_TIME_REMAINING_SECONDS (default 60s)
  - Spot clearly past strike by STRAT2_MIN_SPOT_DISTANCE_FROM_STRIKE
  - Winning side ask <= STRAT2_MAX_ASK_PRICE (default 99c)
  - Buy winning side, hold to settlement

Connections: ``BaseStrategy`` + Binance spot → ``POST /signal/a/2``.

Environment: STRAT2_MAX_TIME_REMAINING_SECONDS, STRAT2_MAX_ASK_PRICE,
    STRAT2_MIN_SPOT_DISTANCE_FROM_STRIKE, STRAT2_MAX_SHARES, STRAT2_MAX_NOTIONAL_USD.
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


class Strategy2Sniper(BaseStrategy):
    """Late-window strike-distance sniper (strategy_id=2)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=2,
                max_notional_usd=float(os.getenv("STRAT2_MAX_NOTIONAL_USD", "100")),
            ),
            use_mock=use_mock,
        )
        self.max_time_remaining = float(os.getenv("STRAT2_MAX_TIME_REMAINING_SECONDS", "60"))
        self.max_ask_price = float(os.getenv("STRAT2_MAX_ASK_PRICE", "0.99"))
        self.min_spot_distance = float(os.getenv("STRAT2_MIN_SPOT_DISTANCE_FROM_STRIKE", "100"))
        self.max_shares = float(os.getenv("STRAT2_MAX_SHARES", "1000"))

    @property
    def name(self) -> str:
        return "strategy_2_sniper"

    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        remaining = self.time_remaining_seconds(market)
        if remaining is None or remaining > self.max_time_remaining:
            return None

        spot = self.binance.latest_price(self.config.asset)
        strike = market.strike
        if spot is None or strike is None:
            return None

        distance = abs(spot - strike)
        if distance < self.min_spot_distance:
            return None

        up_wins = spot > strike
        token_id = market.up_token_id if up_wins else market.down_token_id
        side = "UP" if up_wins else "DOWN"
        if not token_id:
            return None

        book = self.clob.get_order_book(token_id)
        ask = book.best_ask
        if ask is None or ask > self.max_ask_price:
            return None

        shares = min(self.max_shares, self.config.max_notional_usd / ask)
        if shares <= 0:
            return None

        return {
            "market_id": market.market_id,
            "action": "BUY",
            "side": side,
            "price": ask,
            "shares": shares,
            "confidence": min(distance / (self.min_spot_distance * 3), 1.0),
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy2Sniper().run()


if __name__ == "__main__":
    main()
