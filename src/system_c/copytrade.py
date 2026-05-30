"""System C — mirror top Polymarket wallet trades with size caps.

``CopytradeBot`` polls top wallets (via WalletRanker), detects new trades,
and mirrors them to ``POST /signal/c`` with ``COPY_SIZE_MULTIPLIER`` applied.

Trades are only marked "seen" after a successful API response (avoids losing
signals on startup race when API isn't ready yet).

Environment:
  - ``COPY_TARGET_COUNT``, ``COPY_SIZE_MULTIPLIER``, ``COPY_MAX_ORDER_USD``,
    ``COPY_POLL_INTERVAL_MS``, ``DRY_RUN``, ``SIGNAL_SERVICE_URL``
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from typing import Any

import requests
from dotenv import load_dotenv

from src.data.polymarket_clob import MockPolymarketClobClient
from src.system_c.wallet_ranker import WalletRanker

load_dotenv()
logger = logging.getLogger(__name__)

SIGNAL_SERVICE_URL = os.getenv("SIGNAL_SERVICE_URL", "http://localhost:8000")
COPY_TARGET_COUNT = int(os.getenv("COPY_TARGET_COUNT", "10"))
COPY_SIZE_MULTIPLIER = float(os.getenv("COPY_SIZE_MULTIPLIER", "0.1"))
COPY_MAX_ORDER_USD = float(os.getenv("COPY_MAX_ORDER_USD", "5"))
COPY_POLL_INTERVAL_MS = int(os.getenv("COPY_POLL_INTERVAL_MS", "15000"))
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"


class CopytradeBot:
    """Poll ranked wallets and mirror trades to ``POST /signal/c``."""

    def __init__(self, use_mock: bool | None = None) -> None:
        mock = use_mock if use_mock is not None else DRY_RUN
        clob = MockPolymarketClobClient() if mock else None
        self.ranker = WalletRanker(clob=clob, use_mock=mock)
        self.session = requests.Session()
        self._running = False
        self._seen_trades: set[str] = set()

    def _fetch_wallet_trades(self, address: str) -> list[dict[str, Any]]:
        # v1 stub: synthesize one trade per poll for paper mode
        return [
            {
                "trade_id": f"{address}-demo",
                "market_id": "btc-5m-demo",
                "side": "UP",
                "price": 0.45,
                "shares": 20,
                "action": "BUY",
            }
        ]

    def _mirror_trade(self, trade: dict[str, Any]) -> dict[str, Any]:
        trade_key = trade.get("trade_id", "")
        if trade_key in self._seen_trades:
            return {"status": "skipped", "reason": "duplicate"}

        shares = trade["shares"] * COPY_SIZE_MULTIPLIER
        notional = trade["price"] * shares
        if notional > COPY_MAX_ORDER_USD:
            shares = COPY_MAX_ORDER_USD / trade["price"]

        payload = {
            "market_id": trade["market_id"],
            "action": trade.get("action", "BUY"),
            "side": trade["side"],
            "price": trade["price"],
            "shares": shares,
            "confidence": 0.5,
            "mode": "autonomous",
        }
        url = f"{SIGNAL_SERVICE_URL}/signal/c"
        try:
            resp = self.session.post(url, json=payload, timeout=5)
            resp.raise_for_status()
            result = resp.json()
            if result.get("status") == "accepted":
                self._seen_trades.add(trade_key)
            return result
        except requests.RequestException as exc:
            logger.warning("Copytrade signal failed: %s", exc)
            return {"status": "error", "detail": str(exc)}

    def poll_once(self) -> None:
        wallets = self.ranker.fetch_top(COPY_TARGET_COUNT)
        logger.info("Tracking %d wallets (dry_run=%s)", len(wallets), DRY_RUN)
        for wallet in wallets[:3]:
            for trade in self._fetch_wallet_trades(wallet.address):
                result = self._mirror_trade(trade)
                logger.info("Mirrored %s -> %s", wallet.address[:10], result.get("status"))

    def run(self) -> None:
        self._running = True
        interval = COPY_POLL_INTERVAL_MS / 1000
        logger.info("Copytrade started (interval=%ss)", interval)
        while self._running:
            try:
                self.poll_once()
            except Exception as exc:
                logger.exception("Copytrade poll error: %s", exc)
            time.sleep(interval)

    def stop(self) -> None:
        self._running = False


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    bot = CopytradeBot()

    def _shutdown(_signum, _frame) -> None:
        bot.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    bot.run()


if __name__ == "__main__":
    main()
