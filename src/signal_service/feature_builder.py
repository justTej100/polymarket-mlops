"""Build meta-learner feature vectors from runtime state."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime

import redis
from dotenv import load_dotenv

from src.signal_service.benchmark import BenchmarkStore

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


@dataclass
class MetaFeatures:
    hour_utc: float
    day_of_week: float
    btc_volatility_1h: float
    book_depth: float
    win_rate_a: float
    win_rate_b: float
    win_rate_c: float
    minutes_since_b_update: float

    def as_dict(self) -> dict[str, float]:
        return {
            "hour_utc": self.hour_utc,
            "day_of_week": self.day_of_week,
            "btc_volatility_1h": self.btc_volatility_1h,
            "book_depth": self.book_depth,
            "win_rate_a": self.win_rate_a,
            "win_rate_b": self.win_rate_b,
            "win_rate_c": self.win_rate_c,
            "minutes_since_b_update": self.minutes_since_b_update,
        }

    def as_list(self) -> list[float]:
        return list(self.as_dict().values())


class FeatureBuilder:
    def __init__(
        self,
        redis_url: str = REDIS_URL,
        benchmark: BenchmarkStore | None = None,
    ) -> None:
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.benchmark = benchmark or BenchmarkStore()

    def _btc_volatility_1h(self) -> float:
        history = self.redis.lrange("pm:btc:spot:history", 0, -1)
        if len(history) < 2:
            spot = self.redis.hget("pm:spot:btc", "price")
            return 0.01 if spot else 0.0
        prices = [float(p) for p in history]
        if not prices:
            return 0.0
        mean = sum(prices) / len(prices)
        if mean == 0:
            return 0.0
        var = sum((p - mean) ** 2 for p in prices) / len(prices)
        return (var**0.5) / mean

    def _book_depth(self) -> float:
        book = self.redis.hgetall("pm:book:btc") or {}
        bid = float(book.get("bid_size", 0) or 0)
        ask = float(book.get("ask_size", 0) or 0)
        return bid + ask

    def _minutes_since_b_update(self) -> float:
        raw = self.redis.get("pm:system_b:last_update_ms")
        if not raw:
            return 999.0
        delta_ms = int(datetime.now(tz=UTC).timestamp() * 1000) - int(raw)
        return max(delta_ms / 60_000, 0.0)

    def build(self) -> MetaFeatures:
        now = datetime.now(tz=UTC)
        stats = self.benchmark.summary()
        return MetaFeatures(
            hour_utc=now.hour + now.minute / 60,
            day_of_week=float(now.weekday()),
            btc_volatility_1h=self._btc_volatility_1h(),
            book_depth=self._book_depth(),
            win_rate_a=stats["systems"]["a"]["win_rate"],
            win_rate_b=stats["systems"]["b"]["win_rate"],
            win_rate_c=stats["systems"]["c"]["win_rate"],
            minutes_since_b_update=self._minutes_since_b_update(),
        )
