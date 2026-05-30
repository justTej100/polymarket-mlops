"""Polymarket CLOB read client with abstract interface for API drift."""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

CLOB_HTTP_BASE = "https://clob.polymarket.com"
GAMMA_HTTP_BASE = "https://gamma-api.polymarket.com"


@dataclass
class OrderBookLevel:
    price: float
    size: float


@dataclass
class OrderBook:
    market_id: str
    bids: list[OrderBookLevel]
    asks: list[OrderBookLevel]
    timestamp_ms: int

    @property
    def best_bid(self) -> float | None:
        return self.bids[0].price if self.bids else None

    @property
    def best_ask(self) -> float | None:
        return self.asks[0].price if self.asks else None

    @property
    def bid_size(self) -> float:
        return sum(level.size for level in self.bids[:5])

    @property
    def ask_size(self) -> float:
        return sum(level.size for level in self.asks[:5])


@dataclass
class MarketInfo:
    market_id: str
    slug: str
    asset: str
    strike: float | None
    end_time_ms: int | None
    up_token_id: str | None = None
    down_token_id: str | None = None


class PolymarketClobClient(ABC):
    """Abstract CLOB interface — swap implementations when API shape changes."""

    @abstractmethod
    def get_order_book(self, token_id: str) -> OrderBook:
        raise NotImplementedError

    @abstractmethod
    def list_active_markets(self, asset: str = "BTC") -> list[MarketInfo]:
        raise NotImplementedError

    @abstractmethod
    def get_top_wallets(self, limit: int = 10) -> list[dict[str, Any]]:
        raise NotImplementedError


def _parse_levels(raw_levels: list[dict[str, Any]]) -> list[OrderBookLevel]:
    levels: list[OrderBookLevel] = []
    for level in raw_levels:
        try:
            levels.append(
                OrderBookLevel(price=float(level["price"]), size=float(level["size"]))
            )
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(levels, key=lambda x: x.price, reverse=True)


class HttpPolymarketClobClient(PolymarketClobClient):
    """HTTP-backed CLOB reader."""

    def __init__(
        self,
        clob_base: str = CLOB_HTTP_BASE,
        gamma_base: str = GAMMA_HTTP_BASE,
        timeout: float = 10.0,
    ) -> None:
        self.clob_base = clob_base.rstrip("/")
        self.gamma_base = gamma_base.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    def get_order_book(self, token_id: str) -> OrderBook:
        url = f"{self.clob_base}/book"
        resp = self._session.get(url, params={"token_id": token_id}, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        bids = _parse_levels(data.get("bids", []))
        asks = _parse_levels(data.get("asks", []))
        asks.sort(key=lambda x: x.price)
        return OrderBook(
            market_id=token_id,
            bids=bids,
            asks=asks,
            timestamp_ms=int(time.time() * 1000),
        )

    def list_active_markets(self, asset: str = "BTC") -> list[MarketInfo]:
        url = f"{self.gamma_base}/markets"
        resp = self._session.get(
            url,
            params={"active": "true", "closed": "false", "limit": 50},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        markets: list[MarketInfo] = []
        for item in resp.json():
            slug = item.get("slug", "")
            if asset.lower() not in slug.lower():
                continue
            markets.append(
                MarketInfo(
                    market_id=str(item.get("id", slug)),
                    slug=slug,
                    asset=asset.upper(),
                    strike=_extract_strike(item),
                    end_time_ms=_parse_end_time(item),
                    up_token_id=_token_id(item, "up"),
                    down_token_id=_token_id(item, "down"),
                )
            )
        return markets

    def get_top_wallets(self, limit: int = 10) -> list[dict[str, Any]]:
        url = f"{self.gamma_base}/leaderboard"
        try:
            resp = self._session.get(url, params={"limit": limit}, timeout=self.timeout)
            resp.raise_for_status()
            payload = resp.json()
            if isinstance(payload, list):
                return payload[:limit]
            return payload.get("data", [])[:limit]
        except requests.RequestException as exc:
            logger.warning("Leaderboard fetch failed: %s", exc)
            return []


def _extract_strike(item: dict[str, Any]) -> float | None:
    for key in ("strike", "line", "threshold"):
        if key in item and item[key] is not None:
            try:
                return float(item[key])
            except (TypeError, ValueError):
                pass
    return None


def _parse_end_time(item: dict[str, Any]) -> int | None:
    for key in ("endDate", "end_date_iso", "end_time"):
        if key in item and item[key]:
            try:
                from datetime import datetime

                raw = item[key]
                if isinstance(raw, (int, float)):
                    return int(raw)
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                return int(dt.timestamp() * 1000)
            except (TypeError, ValueError):
                continue
    return None


def _token_id(item: dict[str, Any], side: str) -> str | None:
    tokens = item.get("tokens") or item.get("outcomes") or []
    for token in tokens:
        outcome = str(token.get("outcome", "")).lower()
        if side in outcome or (side == "up" and outcome in ("yes", "up")):
            return str(token.get("token_id") or token.get("id") or "")
    return None


class MockPolymarketClobClient(PolymarketClobClient):
    """Fixture-backed client for tests and offline dry-run."""

    def __init__(self) -> None:
        self.books: dict[str, OrderBook] = {}
        self.markets: list[MarketInfo] = []
        self.wallets: list[dict[str, Any]] = []

    def get_order_book(self, token_id: str) -> OrderBook:
        if token_id in self.books:
            return self.books[token_id]
        return OrderBook(
            market_id=token_id,
            bids=[OrderBookLevel(0.48, 100)],
            asks=[OrderBookLevel(0.52, 100)],
            timestamp_ms=int(time.time() * 1000),
        )

    def list_active_markets(self, asset: str = "BTC") -> list[MarketInfo]:
        return [m for m in self.markets if m.asset == asset.upper()] or [
            MarketInfo(
                market_id="btc-5m-demo",
                slug=f"{asset.lower()}-5m-updown-demo",
                asset=asset.upper(),
                strike=67400.0,
                end_time_ms=int(time.time() * 1000) + 120_000,
                up_token_id="up-token",
                down_token_id="down-token",
            )
        ]

    def get_top_wallets(self, limit: int = 10) -> list[dict[str, Any]]:
        if self.wallets:
            return self.wallets[:limit]
        return [
            {"address": f"0xwallet{i:02d}", "pnl_30d": 1000 - i * 50, "rank": i + 1}
            for i in range(limit)
        ]

    def set_book(self, token_id: str, bid: float, ask: float) -> None:
        self.books[token_id] = OrderBook(
            market_id=token_id,
            bids=[OrderBookLevel(bid, 500)],
            asks=[OrderBookLevel(ask, 500)],
            timestamp_ms=int(time.time() * 1000),
        )
