"""Strategy 9 — Dump-Hedge (sharp move arbitrage)."""

from __future__ import annotations

import logging
import os
from typing import Any

from dotenv import load_dotenv

from src.data.polymarket_clob import MarketInfo
from src.system_a.base_strategy import BaseStrategy, StrategyConfig

load_dotenv()
logger = logging.getLogger(__name__)


class Strategy9DumpHedge(BaseStrategy):
    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=9,
                mode=os.getenv("STRAT9_MODE", "autonomous"),
                max_notional_usd=float(os.getenv("STRAT9_MAX_NOTIONAL_HEDGED_USD", "200")),
            ),
            use_mock=use_mock,
        )
        self.dump_pct = float(os.getenv("STRAT9_DUMP_PCT_THRESHOLD", "0.003"))
        self.dump_window = float(os.getenv("STRAT9_DUMP_WINDOW_SECONDS", "10"))
        self.up_max_entry = float(os.getenv("STRAT9_UP_TOKEN_MAX_ENTRY", "0.15"))
        self.hedge_max_combined = float(os.getenv("STRAT9_HEDGE_MAX_COMBINED_COST", "0.98"))
        self.first_leg_shares = float(os.getenv("STRAT9_FIRST_LEG_SHARES", "200"))
        self.max_naked = float(os.getenv("STRAT9_MAX_NOTIONAL_NAKED_USD", "50"))

    @property
    def name(self) -> str:
        return "strategy_9_dump_hedge"

    def _detect_dump(self) -> bool:
        change = self.binance.pct_change(self.config.asset, self.dump_window)
        return change is not None and change <= -self.dump_pct

    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        if not self._detect_dump():
            return None

        up_token = market.up_token_id
        down_token = market.down_token_id
        if not up_token or not down_token:
            return None

        up_book = self.clob.get_order_book(up_token)
        up_ask = up_book.best_ask
        if up_ask is None or up_ask > self.up_max_entry:
            return None

        down_book = self.clob.get_order_book(down_token)
        down_ask = down_book.best_ask or 1.0
        combined = up_ask + down_ask

        if combined <= self.hedge_max_combined:
            shares = min(self.first_leg_shares, self.config.max_notional_usd / combined)
            return {
                "market_id": market.market_id,
                "action": "BUY",
                "side": "UP",
                "price": up_ask,
                "shares": shares,
                "confidence": 0.9,
                "mode": "autonomous",
                "hedge": {"side": "DOWN", "price": down_ask, "shares": shares},
            }

        shares = min(self.first_leg_shares, self.max_naked / up_ask)
        if shares <= 0:
            return None
        return {
            "market_id": market.market_id,
            "action": "BUY",
            "side": "UP",
            "price": up_ask,
            "shares": shares,
            "confidence": 0.6,
            "mode": "autonomous",
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy9DumpHedge().run()


if __name__ == "__main__":
    main()
