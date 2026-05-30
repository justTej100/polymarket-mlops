"""XGBoost + River meta-learner for system confidence weights."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

load_dotenv()

META_COLD_START = os.getenv("META_COLD_START_WEIGHTS", "0.33,0.33,0.33")
META_MIN_OUTCOMES = int(os.getenv("META_MIN_OUTCOMES_TO_LEARN", "50"))
SYSTEMS = ("a", "b", "c")


def _parse_weights(raw: str) -> dict[str, float]:
    parts = [float(x.strip()) for x in raw.split(",")]
    if len(parts) != 3:
        parts = [1 / 3, 1 / 3, 1 / 3]
    total = sum(parts) or 1.0
    return {s: parts[i] / total for i, s in enumerate(SYSTEMS)}


def renormalize_ac(weights: dict[str, float]) -> dict[str, float]:
    """Renormalize A/C weights when B is disabled."""
    a = weights.get("a", 0.0)
    c = weights.get("c", 0.0)
    total = a + c
    if total <= 0:
        return {"a": 0.5, "b": 0.0, "c": 0.5}
    return {"a": a / total, "b": 0.0, "c": c / total}


@dataclass
class MetaLearner:
    state_path: Path = field(default_factory=lambda: Path("data/meta_learner/state.json"))
    cold_start_weights: dict[str, float] = field(
        default_factory=lambda: _parse_weights(META_COLD_START)
    )
    min_outcomes: int = META_MIN_OUTCOMES
    outcomes_seen: int = 0
    weights: dict[str, float] = field(default_factory=dict)
    _xgb_model: Any = field(default=None, init=False, repr=False)
    _river_model: Any = field(default=None, init=False, repr=False)
    _feature_history: list[list[float]] = field(default_factory=list, init=False)
    _label_history: list[int] = field(default_factory=list, init=False)

    def __post_init__(self) -> None:
        self.weights = dict(self.cold_start_weights)
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self._load()
        self._init_models()

    def _init_models(self) -> None:
        try:
            from xgboost import XGBClassifier

            self._xgb_model = XGBClassifier(
                n_estimators=50,
                max_depth=3,
                learning_rate=0.1,
                objective="multi:softprob",
                num_class=3,
                eval_metric="mlogloss",
            )
        except Exception:
            self._xgb_model = None

        try:
            from river import linear_model, preprocessing

            self._river_model = preprocessing.StandardScaler() | linear_model.SoftmaxRegression()
        except Exception:
            self._river_model = None

    def _load(self) -> None:
        if not self.state_path.exists():
            return
        payload = json.loads(self.state_path.read_text())
        self.outcomes_seen = payload.get("outcomes_seen", 0)
        self.weights = payload.get("weights", self.cold_start_weights)
        self._feature_history = payload.get("feature_history", [])
        self._label_history = payload.get("label_history", [])

    def _save(self) -> None:
        self.state_path.write_text(
            json.dumps(
                {
                    "outcomes_seen": self.outcomes_seen,
                    "weights": self.weights,
                    "feature_history": self._feature_history[-500:],
                    "label_history": self._label_history[-500:],
                },
                indent=2,
            )
        )

    def current_weights(self, system_b_enabled: bool = False) -> dict[str, float]:
        if self.outcomes_seen < self.min_outcomes:
            weights = dict(self.cold_start_weights)
        else:
            weights = dict(self.weights)
        if not system_b_enabled:
            return renormalize_ac(weights)
        return weights

    def _label_from_winner(self, winning_system: str) -> int:
        return {"a": 0, "b": 1, "c": 2}.get(winning_system.lower(), 0)

    def record_outcome(self, features: list[float], winning_system: str) -> dict[str, float]:
        label = self._label_from_winner(winning_system)
        self.outcomes_seen += 1
        self._feature_history.append(features)
        self._label_history.append(label)

        if self._river_model is not None:
            x = {f"f{i}": v for i, v in enumerate(features)}
            self._river_model.learn_one(x, label)

        if self._xgb_model is not None and len(self._feature_history) >= self.min_outcomes:
            x_arr = np.array(self._feature_history)
            y_arr = np.array(self._label_history)
            self._xgb_model.fit(x_arr, y_arr)
            probs = self._xgb_model.predict_proba(np.array([features]))[0]
            self.weights = {s: float(probs[i]) for i, s in enumerate(SYSTEMS)}
        elif self._river_model is not None and self.outcomes_seen >= 3:
            x = {f"f{i}": v for i, v in enumerate(features)}
            probs = self._river_model.predict_proba_one(x)
            if probs:
                ordered = sorted(probs.items(), key=lambda kv: kv[0])
                self.weights = {s: float(ordered[i][1]) for i, s in enumerate(SYSTEMS)}

        self._save()
        return self.weights

    def predict_weights(self, features: list[float]) -> dict[str, float]:
        if self.outcomes_seen < self.min_outcomes:
            return dict(self.cold_start_weights)
        if self._xgb_model is not None and hasattr(self._xgb_model, "classes_"):
            probs = self._xgb_model.predict_proba(np.array([features]))[0]
            return {s: float(probs[i]) for i, s in enumerate(SYSTEMS)}
        if self._river_model is not None:
            x = {f"f{i}": v for i, v in enumerate(features)}
            probs = self._river_model.predict_proba_one(x)
            if probs:
                ordered = sorted(probs.items(), key=lambda kv: kv[0])
                return {s: float(ordered[i][1]) for i, s in enumerate(SYSTEMS)}
        return dict(self.weights or self.cold_start_weights)
