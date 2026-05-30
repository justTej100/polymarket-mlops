"""Shared base for System A rule-based strategies.

Every strategy extends ``BaseStrategy`` and implements either:
- ``evaluate()`` — returns one signal dict or None, or
- ``evaluate_signals()`` — returns a list (dual-leg strategies 1, 3, 4, 7).

The main loop (``run()``):
  1. Fetch active market from Polymarket CLOB
  2. Call evaluate / evaluate_signals
  3. POST each signal to FastAPI ``POST /signal/a/{strategy_id}``

Connections:
  - Reads: ``src.data.binance_ws``, ``src.data.polymarket_clob``
  - Writes: ``SIGNAL_SERVICE_URL`` (default http://localhost:8000)

Environment:
  - ``SIGNAL_SERVICE_URL``, ``DRY_RUN`` (mock clients when true)
"""

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
    """Per-strategy runtime settings passed into ``BaseStrategy``."""

    strategy_id: int
    asset: str = "BTC"
    poll_interval: float = 2.0
    max_notional_usd: float = 100.0
    mode: str = "autonomous"


class BaseStrategy(ABC):
    """Poll loop: active market → evaluate → POST signal to the signal service."""

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

    def evaluate(self, market: MarketInfo) -> dict[str, Any] | None:
        """Return a single signal, or None. Override evaluate_signals for multi-leg."""
        return None

    def send_signal(self, signal: dict[str, Any]) -> dict[str, Any]:
        """POST one leg to ``POST /signal/a/{strategy_id}``; returns API JSON or error dict."""
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

    def market_age_seconds(self, market: MarketInfo, period_seconds: float = 300.0) -> float | None:
        if market.end_time_ms is None:
            return None
        start_ms = market.end_time_ms - int(period_seconds * 1000)
        return max((int(time.time() * 1000) - start_ms) / 1000, 0)

    def evaluate_signals(self, market: MarketInfo) -> list[dict[str, Any]]:
        signal = self.evaluate(market)
        return [signal] if signal else []

    def run_once(self) -> None:
        market = self.active_market()
        if not market:
            logger.debug("[%s] No active market", self.name)
            return
        for signal in self.evaluate_signals(market):
            logger.info("[%s] Signal: %s", self.name, signal)
            payload = {k: v for k, v in signal.items() if k != "hedge"}
            self.send_signal(payload)

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
