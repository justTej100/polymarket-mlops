"""Data plane: live market feeds, indicators, and Redis feature publishing.

Submodules:
    ``binance_ws`` — spot mini-ticker WebSocket client for BTC/ETH/SOL/XRP.
    ``polymarket_clob`` — Polymarket CLOB/Gamma HTTP reader (abstract + mock).
    ``indicators`` — MACD, RSI, VWAP, book imbalance helpers.
    ``feature_pipeline`` — long-running process writing ``pm:*`` keys to Redis.

Downstream consumers:
    ``src.signal_service.feature_builder`` reads Redis hashes for meta-learner features.
    ``src.system_a.base_strategy`` uses CLOB + Binance clients directly in strategies.
    ``src.system_c.wallet_ranker`` uses CLOB for leaderboard data.
"""
