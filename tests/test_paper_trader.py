"""Benchmark and paper trader tests."""


def test_record_trade_updates_stats(benchmark):
    benchmark.record_trade(
        system="a",
        market_id="btc-1",
        action="BUY",
        side="UP",
        price=0.5,
        shares=10,
    )
    summary = benchmark.summary()
    assert summary["systems"]["a"]["trades"] == 1


def test_resolve_market_pnl(benchmark, paper):
    paper.execute(
        system="a",
        strategy_id=2,
        market_id="btc-1",
        action="BUY",
        side="UP",
        price=0.5,
        shares=10,
    )
    paper.simulate_resolution("btc-1", "UP")
    assert benchmark.systems["a"].pnl_usd == 5.0
    assert benchmark.systems["a"].wins == 1


def test_resolve_losing_trade(benchmark, paper):
    paper.execute(
        system="c",
        market_id="btc-2",
        action="BUY",
        side="UP",
        price=0.6,
        shares=10,
    )
    paper.simulate_resolution("btc-2", "DOWN")
    assert benchmark.systems["c"].pnl_usd == -6.0
    assert benchmark.systems["c"].losses == 1


def test_notional_cap_enforced(benchmark, paper):
    paper.max_notional_per_order = 5.0
    result = paper.execute(
        system="a",
        strategy_id=2,
        market_id="btc-3",
        action="BUY",
        side="UP",
        price=0.5,
        shares=100,
    )
    assert result["status"] == "accepted"
    assert result["notional_usd"] <= 5.0


def test_session_kill_switch(benchmark, paper):
    paper.session_budget = 100.0
    paper.kill_drawdown_pct = 0.05
    benchmark.systems["a"].pnl_usd = -10.0
    paper._check_kill_switch()
    result = paper.execute(
        system="a",
        strategy_id=2,
        market_id="btc-4",
        action="BUY",
        side="UP",
        price=0.5,
        shares=1,
    )
    assert result["status"] == "rejected"
    assert result["reason"] == "session_kill_switch"
