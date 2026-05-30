"""Strategy 8 — MACD / RSI / VWAP confluence on binary token price."""

from __future__ import annotations

import logging
import os
from collections import deque
from typing import Any

import pandas as pd
from dotenv import load_dotenv

from src.data.indicators import macd, rsi, vwap
from src.data.polymarket_clob import MarketInfo
from src.system_a.base_strategy import BaseStrategy, StrategyConfig

load_dotenv()
logger = logging.getLogger(__name__)


class Strategy8Momentum(BaseStrategy):
    def __init__(self, use_mock: bool | None = None) -> None:
        super().__init__(
            StrategyConfig(
                strategy_id=8,
                max_notional_usd=float(os.getenv("STRAT8_MAX_NOTIONAL_USD", "100")),
            ),
            use_mock=use_mock,
        )
        self.bar_seconds = float(os.getenv("STRAT8_BAR_SECONDS", "5"))
        self.macd_fast = int(os.getenv("STRAT8_MACD_FAST", "3"))
        self.macd_slow = int(os.getenv("STRAT8_MACD_SLOW", "8"))
        self.macd_signal = int(os.getenv("STRAT8_MACD_SIGNAL", "3"))
        self.rsi_period = int(os.getenv("STRAT8_RSI_PERIOD", "14"))
        self.rsi_low = float(os.getenv("STRAT8_RSI_NEUTRAL_LOW", "40"))
        self.rsi_high = float(os.getenv("STRAT8_RSI_NEUTRAL_HIGH", "65"))
        self.rsi_overbought = float(os.getenv("STRAT8_RSI_OVERBOUGHT", "75"))
        self.vwap_stretch = float(os.getenv("STRAT8_VWAP_STRETCH_LIMIT", "0.10"))
        self.min_score = int(os.getenv("STRAT8_MIN_SCORE_TO_ENTER", "4"))
        self._prices: deque[float] = deque(maxlen=120)
        self._volumes: deque[float] = deque(maxlen=120)

    @property
    def name(self) -> str:
        return "strategy_8_momentum"

    def _record_price(self, market: MarketInfo) -> float | None:
        if not market.up_token_id:
            return None
        book = self.clob.get_order_book(market.up_token_id)
        price = book.best_ask or book.best_bid
        if price is None:
            return None
        self._prices.append(price)
        self._volumes.append(max(book.bid_size + book.ask_size, 1.0))
        return price

    def _score(self) -> tuple[int, float | None]:
        if len(self._prices) < max(self.macd_slow + 2, self.rsi_period + 2):
            return 0, None

        series = pd.Series(list(self._prices))
        vols = pd.Series(list(self._volumes))
        macd_line, signal_line, hist = macd(
            series, self.macd_fast, self.macd_slow, self.macd_signal
        )
        rsi_val = float(rsi(series, self.rsi_period).iloc[-1])
        vwap_val = float(vwap(series, vols).iloc[-1])
        price = float(series.iloc[-1])

        score = 0
        if macd_line.iloc[-1] > signal_line.iloc[-1]:
            score += 2
        if hist.iloc[-1] > hist.iloc[-2]:
            score += 1
        if self.rsi_low <= rsi_val <= self.rsi_high:
            score += 1
        if price > vwap_val:
            score += 1
        if rsi_val >= self.rsi_overbought:
            score = 0
        if abs(price - vwap_val) > self.vwap_stretch:
            score -= 1
        return score, price

    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        price = self._record_price(market)
        if price is None:
            return None
        score, current = self._score()
        if score < self.min_score or current is None:
            return None

        shares = self.config.max_notional_usd / current
        if shares <= 0:
            return None
        return {
            "market_id": market.market_id,
            "action": "BUY",
            "side": "UP",
            "price": current,
            "shares": shares,
            "confidence": min(score / 5.0, 1.0),
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    Strategy8Momentum().run()


if __name__ == "__main__":
    main()
