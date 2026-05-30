"""System A — nine independent rule-based Polymarket strategies.

Each strategy module extends ``base_strategy.BaseStrategy``, polls the CLOB (and
often Binance), and POSTs signals to ``POST /signal/a/{strategy_id}``. Enabled
strategies are spawned as separate processes by ``run_all`` when
``RUN_STRAT1`` … ``RUN_STRAT9`` are set.

See ``strategy_1_penny_buy`` through ``strategy_9_dump_hedge`` for entry logic.
"""
