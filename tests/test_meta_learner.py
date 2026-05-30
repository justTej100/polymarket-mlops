"""Meta-learner tests."""

import pytest

from src.signal_service.meta_learner import renormalize_ac


def test_cold_start_weights(meta):
    weights = meta.current_weights(system_b_enabled=False)
    assert abs(weights["a"] + weights["c"] - 1.0) < 1e-6
    assert weights["b"] == 0.0


def test_renormalize_ac():
    weights = renormalize_ac({"a": 0.33, "b": 0.33, "c": 0.33})
    assert weights["b"] == 0.0
    assert abs(weights["a"] - 0.5) < 1e-6
    assert abs(weights["c"] - 0.5) < 1e-6


def test_record_outcome_increments(meta):
    features = [12.0, 2.0, 0.01, 100.0, 0.5, 0.0, 0.5, 60.0]
    meta.record_outcome(features, "a")
    assert meta.outcomes_seen == 1


def test_predict_weights_before_min_outcomes(meta):
    weights = meta.predict_weights([0] * 8)
    assert sum(weights.values()) == pytest.approx(1.0, abs=1e-6)
