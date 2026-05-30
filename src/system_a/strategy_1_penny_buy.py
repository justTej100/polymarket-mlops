"""Strategy 1 — 1c Buy (ultra-cheap dislocation on both sides).

Entry logic:
  - Wait ``STRAT1_ENTRY_DELAY_SECONDS`` after market opens
  - Buy UP and DOWN when asks are at or below bid levels (1c/2c/3c)
  - Cancel unfilled logic: skip if ``remaining <= STRAT1_CANCEL_BEFORE_EXPIRY_SECONDS``
  - Cap total notional at ``STRAT1_MAX_NOTIONAL_USD``

Connections: ``BaseStrategy`` → ``POST /signal/a/1`` (paper trader, system A).

Environment: STRAT1_BID_LEVELS, STRAT1_ENTRY_DELAY_SECONDS, STRAT1_SHARES_PER_ORDER,
    STRAT1_CANCEL_BEFORE_EXPIRY_SECONDS, STRAT1_MAX_NOTIONAL_USD.
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


class Strategy1PennyBuy(BaseStrategy):
    """Dual-side penny dislocation buyer (strategy_id=1)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=1,
                max_notional_usd=float(os.getenv("STRAT1_MAX_NOTIONAL_USD", "20")),
            ),
            use_mock=use_mock,
        )
        self.bid_levels = _parse_levels(os.getenv("STRAT1_BID_LEVELS", "0.01,0.02,0.03"))
        self.entry_delay = float(os.getenv("STRAT1_ENTRY_DELAY_SECONDS", "45"))
        self.shares_per_order = float(os.getenv("STRAT1_SHARES_PER_ORDER", "10"))
        self.cancel_before_expiry = float(os.getenv("STRAT1_CANCEL_BEFORE_EXPIRY_SECONDS", "30"))
        self.max_level = max(self.bid_levels) if self.bid_levels else 0.03

    @property
    def name(self) -> str:
        return "strategy_1_penny_buy"

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        remaining = self.time_remaining_seconds(market)
        age = self.market_age_seconds(market)
        if remaining is None or age is None:
            return []
        if age < self.entry_delay or remaining <= self.cancel_before_expiry:
            return []

        signals: list[dict[str, Any]] = []
        spent = 0.0
        for side, token_id in (("UP", market.up_token_id), ("DOWN", market.down_token_id)):
            if not token_id:
                continue
            ask = self.clob.get_order_book(token_id).best_ask
            if ask is None or ask > self.max_level:
                continue
            notional = ask * self.shares_per_order
            if spent + notional > self.config.max_notional_usd:
                continue
            spent += notional
            signals.append(
                {
                    "market_id": market.market_id,
                    "action": "BUY",
                    "side": side,
                    "price": ask,
                    "shares": self.shares_per_order,
                    "confidence": min((self.max_level - ask) / self.max_level + 0.3, 1.0),
                }
            )
        return signals


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy1PennyBuy().run()


if __name__ == "__main__":
    main()
