"""System C — mirror trades from top Polymarket wallets.

``wallet_ranker`` loads leaderboard wallets from the CLOB client.
``copytrade`` polls those wallets (v1 stub trades in paper mode), scales size,
and POSTs mirrors to ``POST /signal/c`` on the signal service.

Started by ``src.supervisor`` when ``RUN_SYSTEM_C=true``.
"""
