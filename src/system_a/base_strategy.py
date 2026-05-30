"""Shared base for System A strategies."""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import requests
from dotenv import load_dotenv

from src.data.binance_ws import BinanceWSClient, MockBinanceWSClient
from src.data.polymarket_clob import (
    HttpPolymarketClobClient,
    MarketInfo,
    MockPolymarketClobClient,
    PolymarketClobClient,
)

load_dotenv()

logger = logging.getLogger(__name__)

SIGNAL_SERVICE_URL = os.getenv("SIGNAL_SERVICE_URL", "http://localhost:8000")
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"


@dataclass
class StrategyConfig:
    strategy_id: int
    asset: str = "BTC"
    poll_interval: float = 2.0
    max_notional_usd: float = 100.0
    mode: str = "autonomous"


class BaseStrategy(ABC):
    def __init__(
        self,
        config: StrategyConfig,
        clob: PolymarketClobClient | None = None,
        binance: BinanceWSClient | None = None,
        use_mock: bool | None = None,
    ) -> None:
        self.config = config
        mock = use_mock if use_mock is not None else DRY_RUN
        self.clob = clob or (MockPolymarketClobClient() if mock else HttpPolymarketClobClient())
        self.binance = binance or (MockBinanceWSClient() if mock else BinanceWSClient())
        self._running = False
        self._session = requests.Session()

    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        """Return signal dict or None if no action."""
        raise NotImplementedError

    def send_signal(self, signal: dict[str, Any]) -> dict[str, Any]:
        url = f"{SIGNAL_SERVICE_URL}/signal/a/{self.config.strategy_id}"
        payload = {
            "market_id": signal["market_id"],
            "action": signal.get("action", "BUY"),
            "side": signal["side"],
            "price": signal["price"],
            "shares": signal["shares"],
            "confidence": signal.get("confidence", 0.5),
            "mode": signal.get("mode", self.config.mode),
        }
        try:
            resp = self._session.post(url, json=payload, timeout=5)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("[%s] Signal POST failed: %s", self.name, exc)
            return {"status": "error", "detail": str(exc)}

    def active_market(self) -> MarketInfo | None:
        markets = self.clob.list_active_markets(asset=self.config.asset)
        return markets[0] if markets else None

    def time_remaining_seconds(self, market: MarketInfo) -> float | None:
        if market.end_time_ms is None:
            return None
        return max((market.end_time_ms - int(time.time() * 1000)) / 1000, 0)

    def run_once(self) -> None:
        market = self.active_market()
        if not market:
            logger.debug("[%s] No active market", self.name)
            return
        signal = self.evaluate(market)
        if signal:
            logger.info("[%s] Signal: %s", self.name, signal)
            self.send_signal(signal)

    def run(self) -> None:
        self._running = True
        if hasattr(self.binance, "start"):
            self.binance.start()
        logger.info("[%s] Started (dry_run=%s)", self.name, DRY_RUN)
        while self._running:
            try:
                self.run_once()
            except Exception as exc:
                logger.exception("[%s] Loop error: %s", self.name, exc)
            time.sleep(self.config.poll_interval)

    def stop(self) -> None:
        self._running = False
        if hasattr(self.binance, "stop"):
            self.binance.stop()
