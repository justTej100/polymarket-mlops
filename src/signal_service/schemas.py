"""OpenAPI response models — explicit schemas for Swagger and clients.

Without these Pydantic models, FastAPI shows generic ``additionalProp1`` placeholders
in /docs. Each model maps 1:1 to a GET/POST response body.

Models: BenchmarkResponse, MetaWeightsResponse, HealthResponse, OutcomeResponse.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SystemBenchmarkStats(BaseModel):
    pnl_usd: float = 0.0
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0


class BenchmarkSystems(BaseModel):
    a: SystemBenchmarkStats
    b: SystemBenchmarkStats
    c: SystemBenchmarkStats


class BenchmarkResponse(BaseModel):
    systems: BenchmarkSystems
    total_trades: int = 0


class MetaWeights(BaseModel):
    a: float
    b: float
    c: float


class MetaWeightsResponse(BaseModel):
    weights: MetaWeights
    outcomes_seen: int
    min_outcomes_to_learn: int
    features: dict[str, Any] = Field(default_factory=dict)
    system_b_enabled: bool


class HealthResponse(BaseModel):
    status: str


class OutcomeResponse(BaseModel):
    resolved_trades: int
    weights: MetaWeights
