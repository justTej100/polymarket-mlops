"""FastAPI signal service — central hub for all trading signals.

HTTP API (port 8000):
  - ``POST /signal/a/{strategy_id}`` — System A strategy signals
  - ``POST /signal/c`` — System C copytrade mirrors
  - ``POST /signal/b`` — System B stub (disabled in v1)
  - ``POST /outcome`` — record market resolution → PnL + meta-learner
  - ``GET /benchmark`` — per-system PnL and win rates
  - ``GET /meta/weights`` — current A/B/C confidence weights
  - ``GET /metrics`` — Prometheus scrape endpoint

Wires together:
  - ``BenchmarkStore`` — trade log and stats
  - ``PaperOrderSimulator`` — DRY_RUN order execution
  - ``MetaLearner`` — XGBoost + River weight updates
  - ``FeatureBuilder`` — meta-learner input features from Redis

Environment:
  - ``RUN_SYSTEM_B`` — if false, meta weights renormalize to A/C only
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, generate_latest
from pydantic import BaseModel, Field
from starlette.responses import Response

from src.signal_service.benchmark import BenchmarkStore
from src.signal_service.feature_builder import FeatureBuilder
from src.signal_service.meta_learner import MetaLearner, renormalize_ac
from src.signal_service.paper_trader import PaperOrderSimulator
from src.signal_service.schemas import (
    BenchmarkResponse,
    HealthResponse,
    MetaWeights,
    MetaWeightsResponse,
    OutcomeResponse,
)

load_dotenv()
logger = logging.getLogger(__name__)

RUN_SYSTEM_B = os.getenv("RUN_SYSTEM_B", "false").lower() == "true"

benchmark = BenchmarkStore()
meta = MetaLearner()
features = FeatureBuilder(benchmark=benchmark)
paper = PaperOrderSimulator(benchmark=benchmark)

SIGNALS_TOTAL = Counter(
    "polymarket_signals_total",
    "Total signals received",
    ["system", "action"],
)
PNL_GAUGE = Gauge("polymarket_pnl_total", "Paper PnL by system", ["system"])
WIN_RATE_GAUGE = Gauge("polymarket_win_rate", "Win rate by system", ["system"])
META_WEIGHT_GAUGE = Gauge("polymarket_meta_weight", "Meta-learner weight", ["system"])


class SignalPayload(BaseModel):
    system: str | None = None
    strategy_id: int | None = None
    market_id: str
    action: str
    side: str
    price: float = Field(gt=0, le=1)
    shares: float = Field(gt=0)
    confidence: float = Field(default=0.5, ge=0, le=1)
    mode: str = "autonomous"


class OutcomePayload(BaseModel):
    market_id: str
    winning_side: str
    winning_system: str | None = None


class SystemBSignal(BaseModel):
    action: str = "HOLD"
    asset: str = "BTC"
    confidence: float = 0.0
    directional_bias: str = "NEUTRAL"
    reasoning: str = ""
    risk_assessment: str = "DISABLED"


def _update_metrics() -> None:
    summary = benchmark.summary()
    for system, stats in summary["systems"].items():
        PNL_GAUGE.labels(system=system).set(stats["pnl_usd"])
        WIN_RATE_GAUGE.labels(system=system).set(stats["win_rate"])
    weights = meta.current_weights(system_b_enabled=RUN_SYSTEM_B)
    for system, weight in weights.items():
        META_WEIGHT_GAUGE.labels(system=system).set(weight)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _update_metrics()
    yield


app = FastAPI(title="Polymarket Signal Service", version="0.1.0", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/benchmark", response_model=BenchmarkResponse)
def get_benchmark() -> BenchmarkResponse:
    _update_metrics()
    return BenchmarkResponse.model_validate(benchmark.summary())


@app.get("/meta/weights", response_model=MetaWeightsResponse)
def get_meta_weights() -> MetaWeightsResponse:
    feat = features.build()
    raw = meta.predict_weights(feat.as_list())
    weights_dict = renormalize_ac(raw) if not RUN_SYSTEM_B else raw
    return MetaWeightsResponse(
        weights=MetaWeights(**weights_dict),
        outcomes_seen=meta.outcomes_seen,
        min_outcomes_to_learn=meta.min_outcomes,
        features=feat.as_dict(),
        system_b_enabled=RUN_SYSTEM_B,
    )


@app.get("/metrics")
def metrics() -> Response:
    _update_metrics()
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/signal/a/{strategy_id}")
def signal_system_a(strategy_id: int, payload: SignalPayload) -> dict[str, Any]:
    result = paper.execute(
        system="a",
        strategy_id=strategy_id,
        market_id=payload.market_id,
        action=payload.action.upper(),
        side=payload.side.upper(),
        price=payload.price,
        shares=payload.shares,
        confidence=payload.confidence,
        mode=payload.mode,
    )
    SIGNALS_TOTAL.labels(system="a", action=payload.action.upper()).inc()
    _update_metrics()
    if result["status"] == "rejected":
        raise HTTPException(status_code=429, detail=result)
    return result


@app.post("/signal/b")
def signal_system_b(_payload: SystemBSignal | None = None) -> dict[str, Any]:
    """System B stub — disabled in v1."""
    return {
        "status": "disabled",
        "message": "System B agent panel is not enabled in v1",
        "system_b_enabled": RUN_SYSTEM_B,
    }


@app.post("/signal/c")
def signal_system_c(payload: SignalPayload) -> dict[str, Any]:
    result = paper.execute(
        system="c",
        strategy_id=None,
        market_id=payload.market_id,
        action=payload.action.upper(),
        side=payload.side.upper(),
        price=payload.price,
        shares=payload.shares,
        confidence=payload.confidence,
        mode=payload.mode,
    )
    SIGNALS_TOTAL.labels(system="c", action=payload.action.upper()).inc()
    _update_metrics()
    if result["status"] == "rejected":
        raise HTTPException(status_code=429, detail=result)
    return result


@app.post("/outcome", response_model=OutcomeResponse)
def record_outcome(payload: OutcomePayload) -> OutcomeResponse:
    """Record market resolution for paper PnL and meta-learner training."""
    resolved = paper.simulate_resolution(payload.market_id, payload.winning_side)
    winner = payload.winning_system
    weights = meta.current_weights(system_b_enabled=RUN_SYSTEM_B)
    if winner:
        feat = features.build()
        weights = meta.record_outcome(feat.as_list(), winner)
        if not RUN_SYSTEM_B:
            weights = renormalize_ac(weights)
    _update_metrics()
    return OutcomeResponse(
        resolved_trades=len(resolved),
        weights=MetaWeights(**weights),
    )
