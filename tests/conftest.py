"""Pytest configuration and shared fixtures."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.signal_service.benchmark import BenchmarkStore
from src.signal_service.main import app
from src.signal_service.meta_learner import MetaLearner
from src.signal_service.paper_trader import PaperOrderSimulator


@pytest.fixture
def benchmark(tmp_path):
    return BenchmarkStore(data_dir=tmp_path / "benchmark")


@pytest.fixture
def paper(benchmark):
    return PaperOrderSimulator(benchmark=benchmark, dry_run=True)


@pytest.fixture
def meta(tmp_path):
    return MetaLearner(state_path=tmp_path / "meta" / "state.json", min_outcomes=3)


@pytest.fixture
def client():
    return TestClient(app)
