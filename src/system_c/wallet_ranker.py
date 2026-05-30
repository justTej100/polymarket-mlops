"""Rank Polymarket wallets by 30-day PnL for copytrade targeting.

``WalletRanker.fetch_top(n)`` returns the highest-PnL wallets from the CLOB
leaderboard API (or mock data in DRY_RUN).

Used by: copytrade.py
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from src.data.polymarket_clob import (
    HttpPolymarketClobClient,
    MockPolymarketClobClient,
    PolymarketClobClient,
)

logger = logging.getLogger(__name__)


@dataclass
class RankedWallet:
    """Leaderboard row: wallet address, 30d PnL, and rank."""

    address: str
    pnl_30d: float
    rank: int


class WalletRanker:
    """Fetch and sort top wallets from ``PolymarketClobClient.get_top_wallets``."""

    def __init__(self, clob: PolymarketClobClient | None = None, use_mock: bool = True) -> None:
        self.clob = clob or (MockPolymarketClobClient() if use_mock else HttpPolymarketClobClient())

    def fetch_top(self, limit: int = 10) -> list[RankedWallet]:
        raw = self.clob.get_top_wallets(limit=limit)
        wallets: list[RankedWallet] = []
        for idx, item in enumerate(raw):
            address = str(item.get("address") or item.get("wallet") or f"unknown-{idx}")
            pnl = float(item.get("pnl_30d") or item.get("pnl") or 0)
            rank = int(item.get("rank") or idx + 1)
            wallets.append(RankedWallet(address=address, pnl_30d=pnl, rank=rank))
        wallets.sort(key=lambda w: w.pnl_30d, reverse=True)
        return wallets[:limit]

    def as_dicts(self, limit: int = 10) -> list[dict[str, Any]]:
        return [
            {"address": w.address, "pnl_30d": w.pnl_30d, "rank": w.rank}
            for w in self.fetch_top(limit)
        ]
