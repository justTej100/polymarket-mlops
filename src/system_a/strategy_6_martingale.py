"""Strategy 6 — Martingale / Anti-Martingale around mid prices (~45c).

Modes (STRAT6_MODE):
  - martingale: add on dips in ranging market (low BTC vol)
  - anti_martingale: add on confirmation moves in trending market
  - auto: pick mode from regime detection via binance pct_change

Connections: ``BaseStrategy`` + Binance regime → ``POST /signal/a/6``.

Environment: STRAT6_MODE, STRAT6_ENTRY_PRICE, STRAT6_ENTRY_RANGE,
    STRAT6_MARTINGALE_HARD_STOP, STRAT6_ANTI_CONFIRM_MOVE, STRAT6_REGIME_LOOKBACK_SECONDS,
    STRAT6_MAX_NOTIONAL_USD.
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


class Strategy6Martingale(BaseStrategy):
    """Martingale dips or anti-martingale adds on UP token (strategy_id=6)."""

    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=6,
                max_notional_usd=float(os.getenv("STRAT6_MAX_NOTIONAL_USD", "150")),
            ),
            use_mock=use_mock,
        )
        self.mode = os.getenv("STRAT6_MODE", "auto").lower()
        self.entry_price = float(os.getenv("STRAT6_ENTRY_PRICE", "0.45"))
        self.entry_range = float(os.getenv("STRAT6_ENTRY_RANGE", "0.03"))
        self.hard_stop = float(os.getenv("STRAT6_MARTINGALE_HARD_STOP", "0.15"))
        self.confirm_move = float(os.getenv("STRAT6_ANTI_CONFIRM_MOVE", "0.07"))
        self.regime_lookback = float(os.getenv("STRAT6_REGIME_LOOKBACK_SECONDS", "120"))
        self._adds: dict[str, int] = {}

    @property
    def name(self) -> str:
        return "strategy_6_martingale"

    def _is_ranging(self) -> bool:
        change = self.binance.pct_change(self.config.asset, self.regime_lookback)
        if change is None:
            return True
        return abs(change) < 0.001

    def _is_trending(self) -> bool:
        change = self.binance.pct_change(self.config.asset, self.regime_lookback)
        if change is None:
            return False
        return abs(change) >= 0.002

    def _pick_mode(self) -> str:
        if self.mode in ("martingale", "anti_martingale"):
            return self.mode
        return "martingale" if self._is_ranging() else "anti_martingale"

    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        if not market.up_token_id:
            return None
        ask = self.clob.get_order_book(market.up_token_id).best_ask
        if ask is None or ask <= self.hard_stop:
            return None

        mode = self._pick_mode()
        low = self.entry_price - self.entry_range
        adds = self._adds.get(market.market_id, 0)

        if mode == "martingale":
            if not self._is_ranging():
                return None
            trigger = low - (adds * 0.07)
            if ask > trigger + self.entry_range:
                return None
        else:
            if not self._is_trending():
                return None
            trigger = self.entry_price + self.confirm_move * adds
            if ask < trigger:
                return None

        shares = self.config.max_notional_usd / (3 - adds) / ask
        if shares <= 0 or adds >= 2:
            return None

        self._adds[market.market_id] = adds + 1
        return {
            "market_id": market.market_id,
            "action": "BUY",
            "side": "UP",
            "price": ask,
            "shares": shares,
            "confidence": 0.55 if mode == "martingale" else 0.7,
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy6Martingale().run()


if __name__ == "__main__":
    main()
