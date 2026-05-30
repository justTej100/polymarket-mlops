"""Copytrade bot behavior tests."""

from __future__ import annotations

from unittest.mock import MagicMock

import requests

from src.system_c.copytrade import CopytradeBot


def test_mirror_marks_seen_only_after_accepted():
    bot = CopytradeBot(use_mock=True)
    bot.session = MagicMock()

    ok_resp = MagicMock()
    ok_resp.raise_for_status = MagicMock()
    ok_resp.json.return_value = {"status": "accepted", "trade_id": "t1"}

    fail_resp = MagicMock()
    fail_resp.raise_for_status.side_effect = requests.ConnectionError("refused")

    bot.session.post.side_effect = [fail_resp, ok_resp]

    trade = {
        "trade_id": "wallet-demo",
        "market_id": "btc-5m-demo",
        "side": "UP",
        "price": 0.45,
        "shares": 20,
        "action": "BUY",
    }

    first = bot._mirror_trade(trade)
    assert first["status"] == "error"
    assert "wallet-demo" not in bot._seen_trades

    second = bot._mirror_trade(trade)
    assert second["status"] == "accepted"
    assert "wallet-demo" in bot._seen_trades

    third = bot._mirror_trade(trade)
    assert third["status"] == "skipped"


def test_mirror_does_not_mark_seen_on_rejected():
    bot = CopytradeBot(use_mock=True)
    bot.session = MagicMock()

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"status": "rejected", "reason": "cap"}
    bot.session.post.return_value = resp

    trade = {
        "trade_id": "wallet-reject",
        "market_id": "btc-5m-demo",
        "side": "UP",
        "price": 0.45,
        "shares": 20,
        "action": "BUY",
    }

    result = bot._mirror_trade(trade)
    assert result["status"] == "rejected"
    assert "wallet-reject" not in bot._seen_trades
