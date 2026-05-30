"""Binance WebSocket client for BTC/ETH/SOL/XRP spot streams."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

import websocket

logger = logging.getLogger(__name__)

ASSETS = ("BTC", "ETH", "SOL", "XRP")
BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"


@dataclass
class PriceTick:
    asset: str
    price: float
    timestamp_ms: int


@dataclass
class BinanceWSClient:
    """Subscribe to combined mini-ticker streams for supported assets."""

    assets: tuple[str, ...] = ASSETS
    on_tick: Callable[[PriceTick], None] | None = None
    _ws: websocket.WebSocketApp | None = field(default=None, init=False, repr=False)
    _thread: threading.Thread | None = field(default=None, init=False, repr=False)
    _running: bool = field(default=False, init=False)
    price_history: dict[str, deque[tuple[int, float]]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for asset in self.assets:
            self.price_history[asset] = deque(maxlen=500)

    def _stream_url(self) -> str:
        streams = "/".join(f"{a.lower()}usdt@miniTicker" for a in self.assets)
        return f"{BINANCE_WS_BASE}/{streams}"

    def _handle_message(self, _ws: websocket.WebSocketApp, message: str) -> None:
        try:
            payload = json.loads(message)
            data = payload.get("data", payload)
            symbol = data.get("s", "")
            asset = symbol.replace("USDT", "")
            if asset not in self.assets:
                return
            price = float(data["c"])
            ts = int(data.get("E", time.time() * 1000))
            self.price_history[asset].append((ts, price))
            tick = PriceTick(asset=asset, price=price, timestamp_ms=ts)
            if self.on_tick:
                self.on_tick(tick)
        except (KeyError, TypeError, ValueError) as exc:
            logger.debug("Skipping malformed tick: %s", exc)

    def _handle_error(self, _ws: websocket.WebSocketApp, error: Exception) -> None:
        logger.warning("Binance WS error: %s", error)

    def _handle_close(self, _ws: websocket.WebSocketApp, *_args) -> None:
        logger.info("Binance WS closed")
        if self._running:
            time.sleep(2)
            self.start()

    def start(self) -> None:
        if self._running and self._thread and self._thread.is_alive():
            return
        self._running = True
        self._ws = websocket.WebSocketApp(
            self._stream_url(),
            on_message=self._handle_message,
            on_error=self._handle_error,
            on_close=self._handle_close,
        )
        self._thread = threading.Thread(target=self._ws.run_forever, daemon=True)
        self._thread.start()
        logger.info("Binance WS started for %s", ", ".join(self.assets))

    def stop(self) -> None:
        self._running = False
        if self._ws:
            self._ws.close()

    def latest_price(self, asset: str) -> float | None:
        history = self.price_history.get(asset.upper())
        if not history:
            return None
        return history[-1][1]

    def pct_change(self, asset: str, window_seconds: float) -> float | None:
        """Return fractional price change over the last N seconds."""
        history = self.price_history.get(asset.upper())
        if not history or len(history) < 2:
            return None
        now_ts, now_price = history[-1]
        cutoff = now_ts - int(window_seconds * 1000)
        baseline = None
        for ts, price in history:
            if ts >= cutoff:
                baseline = price
                break
        if baseline is None or baseline == 0:
            return None
        return (now_price - baseline) / baseline


class MockBinanceWSClient(BinanceWSClient):
    """In-memory client for tests and dry-run without network."""

    def __init__(self, assets: tuple[str, ...] = ASSETS) -> None:
        super().__init__(assets=assets, on_tick=None)

    def start(self) -> None:
        self._running = True
        logger.info("Mock Binance WS started")

    def stop(self) -> None:
        self._running = False

    def push_tick(self, asset: str, price: float, timestamp_ms: int | None = None) -> None:
        ts = timestamp_ms or int(time.time() * 1000)
        self.price_history[asset.upper()].append((ts, price))
        if self.on_tick:
            self.on_tick(PriceTick(asset=asset.upper(), price=price, timestamp_ms=ts))
