"""Signal service API integration tests."""


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_benchmark_endpoint(client):
    resp = client.get("/benchmark")
    assert resp.status_code == 200
    data = resp.json()
    assert "systems" in data
    assert set(data["systems"].keys()) == {"a", "b", "c"}
    for system in ("a", "b", "c"):
        stats = data["systems"][system]
        assert set(stats.keys()) == {"pnl_usd", "trades", "wins", "losses", "win_rate"}
        assert isinstance(stats["pnl_usd"], (int, float))
    assert "total_trades" in data
    assert "additionalProp1" not in data


def test_benchmark_openapi_schema(client):
    """Swagger must expose explicit benchmark fields, not generic additionalProp."""
    schema = client.get("/openapi.json").json()
    benchmark_props = schema["components"]["schemas"]["BenchmarkResponse"]["properties"]
    assert "systems" in benchmark_props
    assert "total_trades" in benchmark_props
    systems_schema = schema["components"]["schemas"]["BenchmarkSystems"]["properties"]
    assert set(systems_schema.keys()) == {"a", "b", "c"}


def test_benchmark_after_trade(client):
    client.post(
        "/signal/c",
        json={
            "market_id": "bench-demo",
            "action": "BUY",
            "side": "UP",
            "price": 0.5,
            "shares": 10,
            "confidence": 0.5,
        },
    )
    data = client.get("/benchmark").json()
    assert data["total_trades"] >= 1
    assert data["systems"]["c"]["trades"] >= 1


def test_meta_weights(client):
    resp = client.get("/meta/weights")
    assert resp.status_code == 200
    data = resp.json()
    assert "weights" in data
    weights = data["weights"]
    assert set(weights.keys()) == {"a", "b", "c"}
    assert abs(weights["a"] + weights["c"] - 1.0) < 1e-3
    assert weights["b"] == 0.0
    assert "outcomes_seen" in data
    assert "min_outcomes_to_learn" in data


def test_metrics_endpoint(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert b"polymarket_pnl_total" in resp.content


def test_signal_system_a(client):
    payload = {
        "market_id": "btc-demo",
        "action": "BUY",
        "side": "UP",
        "price": 0.12,
        "shares": 100,
        "confidence": 0.8,
        "mode": "autonomous",
    }
    resp = client.post("/signal/a/9", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "accepted"
    assert data["dry_run"] is True


def test_signal_system_b_stub(client):
    resp = client.post("/signal/b", json={"action": "BUY"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "disabled"


def test_signal_system_c(client):
    payload = {
        "market_id": "btc-demo",
        "action": "BUY",
        "side": "DOWN",
        "price": 0.45,
        "shares": 10,
        "confidence": 0.5,
    }
    resp = client.post("/signal/c", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


def test_outcome_resolution(client):
    client.post(
        "/signal/a/2",
        json={
            "market_id": "resolve-demo",
            "action": "BUY",
            "side": "UP",
            "price": 0.4,
            "shares": 10,
            "confidence": 0.7,
        },
    )
    resp = client.post(
        "/outcome",
        json={"market_id": "resolve-demo", "winning_side": "UP", "winning_system": "a"},
    )
    assert resp.status_code == 200
    assert resp.json()["resolved_trades"] == 1


def test_invalid_signal_rejected(client):
    resp = client.post(
        "/signal/a/2",
        json={
            "market_id": "bad",
            "action": "BUY",
            "side": "UP",
            "price": 0,
            "shares": 10,
        },
    )
    assert resp.status_code == 422
