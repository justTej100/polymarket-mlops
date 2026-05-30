"""Strategy 5 — Cross-Market lead-lag (BTC leads, altcoins lag).

Entry logic (Variant A from README):
  - Detect BTC move >= STRAT5_MIN_LEAD_MOVE_PCT over STRAT5_MAX_LAG_SECONDS
  - For each lag asset (ETH/SOL/XRP), if UP token not yet repriced (ask <= 55c)
  - Aggressive buy on lag market with slippage buffer

Connections: Binance lead asset + lag ``list_active_markets`` → ``POST /signal/a/5``.

Environment: STRAT5_LEAD_ASSET, STRAT5_LAG_ASSETS, STRAT5_MIN_LEAD_MOVE_PCT,
    STRAT5_AGGRESSIVE_LIMIT_SLIPPAGE, STRAT5_MAX_LAG_SECONDS, STRAT5_MAX_NOTIONAL_PER_PAIR_USD.
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


class Strategy5CrossMarket(BaseStrategy):
    """BTC lead, alt lag momentum (strategy_id=5)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=5,
                asset=os.getenv("STRAT5_LEAD_ASSET", "BTC"),
                max_notional_usd=float(os.getenv("STRAT5_MAX_NOTIONAL_PER_PAIR_USD", "75")),
            ),
            use_mock=use_mock,
        )
        self.lag_assets = [
            a.strip().upper()
            for a in os.getenv("STRAT5_LAG_ASSETS", "ETH,SOL,XRP").split(",")
            if a.strip()
        ]
        self.min_lead_move = float(os.getenv("STRAT5_MIN_LEAD_MOVE_PCT", "0.0025"))
        self.max_slippage = float(os.getenv("STRAT5_AGGRESSIVE_LIMIT_SLIPPAGE", "0.03"))
        self.lead_window = float(os.getenv("STRAT5_MAX_LAG_SECONDS", "30"))

    @property
    def name(self) -> str:
        return "strategy_5_cross_market"

    def _lead_moved(self) -> bool:
        change = self.binance.pct_change(self.config.asset, self.lead_window)
        return change is not None and change >= self.min_lead_move

    def _lag_not_repriced(self, market: MarketInfo, threshold: float = 0.55) -> bool:
        if not market.up_token_id:
            return False
        ask = self.clob.get_order_book(market.up_token_id).best_ask
        return ask is not None and ask <= threshold

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        if not self._lead_moved():
            return []

        signals: list[dict[str, Any]] = []
        for asset in self.lag_assets:
            lag_markets = self.clob.list_active_markets(asset=asset)
            if not lag_markets:
                continue
            lag = lag_markets[0]
            if not self._lag_not_repriced(lag):
                continue
            ask = self.clob.get_order_book(lag.up_token_id or "").best_ask or 0.5
            price = min(ask + self.max_slippage, 0.99)
            shares = self.config.max_notional_usd / price
            if shares <= 0:
                continue
            signals.append(
                {
                    "market_id": lag.market_id,
                    "action": "BUY",
                    "side": "UP",
                    "price": price,
                    "shares": shares,
                    "confidence": 0.75,
                }
            )
        return signals


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy5CrossMarket().run()


if __name__ == "__main__":
    main()
