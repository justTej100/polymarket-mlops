"""Feature builder tests."""

from src.signal_service.feature_builder import FeatureBuilder, MetaFeatures


def test_meta_features_as_list():
    feat = MetaFeatures(
        hour_utc=14.5,
        day_of_week=2.0,
        btc_volatility_1h=0.02,
        book_depth=500.0,
        win_rate_a=0.6,
        win_rate_b=0.0,
        win_rate_c=0.4,
        minutes_since_b_update=120.0,
    )
    assert len(feat.as_list()) == 8
    assert feat.as_dict()["hour_utc"] == 14.5


def test_feature_builder_from_benchmark(benchmark):
    benchmark.record_trade(
        system="a",
        market_id="m1",
        action="BUY",
        side="UP",
        price=0.5,
        shares=10,
        won=True,
        pnl_usd=5.0,
    )
    builder = FeatureBuilder(benchmark=benchmark, redis_url="redis://localhost:9")
    feat = builder.build()
    assert feat.win_rate_a == 1.0
    assert 0 <= feat.hour_utc <= 24
