"""Per-system PnL, win rate, and trade log tracking.

``BenchmarkStore`` persists:
  - ``data/benchmark/state.json`` — aggregate stats per system (a/b/c)
  - ``data/benchmark/trade_log.jsonl`` — one JSON line per trade

``resolve_market(market_id, winning_side)`` marks open trades won/lost and
updates PnL when a 5-minute market settles.

Consumed by: paper_trader, main.py ``/benchmark``, feature_builder, Grafana via Prometheus.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.signal_service.schemas import BenchmarkResponse, BenchmarkSystems, SystemBenchmarkStats


@dataclass
class TradeRecord:
    """One paper trade row persisted to the JSONL trade log."""

    trade_id: str
    system: str
    strategy_id: int | None
    market_id: str
    action: str
    side: str
    price: float
    shares: float
    notional_usd: float
    pnl_usd: float
    won: bool | None
    timestamp: str
    mode: str = "autonomous"
    confidence: float = 0.0
    dry_run: bool = True


@dataclass
class SystemStats:
    pnl_usd: float = 0.0
    trades: int = 0
    wins: int = 0
    losses: int = 0

    @property
    def win_rate(self) -> float:
        resolved = self.wins + self.losses
        return self.wins / resolved if resolved else 0.0


@dataclass
class BenchmarkStore:
    """Thread-safe trade log and per-system PnL/win-rate aggregates."""

    data_dir: Path = field(default_factory=lambda: Path("data/benchmark"))
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    systems: dict[str, SystemStats] = field(
        default_factory=lambda: {"a": SystemStats(), "b": SystemStats(), "c": SystemStats()}
    )
    trades: list[TradeRecord] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._load()

    @property
    def trade_log_path(self) -> Path:
        return self.data_dir / "trade_log.jsonl"

    @property
    def state_path(self) -> Path:
        return self.data_dir / "state.json"

    def _load(self) -> None:
        if self.state_path.exists():
            payload = json.loads(self.state_path.read_text())
            for key, stats in payload.get("systems", {}).items():
                self.systems[key] = SystemStats(**stats)
        if self.trade_log_path.exists():
            for line in self.trade_log_path.read_text().splitlines():
                if line.strip():
                    self.trades.append(TradeRecord(**json.loads(line)))

    def _persist(self) -> None:
        self.state_path.write_text(
            json.dumps(
                {"systems": {k: asdict(v) for k, v in self.systems.items()}},
                indent=2,
            )
        )

    def record_trade(
        self,
        *,
        system: str,
        market_id: str,
        action: str,
        side: str,
        price: float,
        shares: float,
        strategy_id: int | None = None,
        pnl_usd: float = 0.0,
        won: bool | None = None,
        mode: str = "autonomous",
        confidence: float = 0.0,
        dry_run: bool = True,
    ) -> TradeRecord:
        system = system.lower()
        notional = price * shares
        trade = TradeRecord(
            trade_id=str(uuid.uuid4()),
            system=system,
            strategy_id=strategy_id,
            market_id=market_id,
            action=action,
            side=side,
            price=price,
            shares=shares,
            notional_usd=notional,
            pnl_usd=pnl_usd,
            won=won,
            timestamp=datetime.now(tz=UTC).isoformat(),
            mode=mode,
            confidence=confidence,
            dry_run=dry_run,
        )
        with self._lock:
            stats = self.systems.setdefault(system, SystemStats())
            stats.trades += 1
            stats.pnl_usd += pnl_usd
            if won is True:
                stats.wins += 1
            elif won is False:
                stats.losses += 1
            self.trades.append(trade)
            with self.trade_log_path.open("a") as fh:
                fh.write(json.dumps(asdict(trade)) + "\n")
            self._persist()
        return trade

    def resolve_market(
        self,
        market_id: str,
        winning_side: str,
        settlement_price: float = 1.0,
    ) -> list[TradeRecord]:
        """Resolve open paper trades for a market (for tests / simulation)."""
        resolved: list[TradeRecord] = []
        winning_side = winning_side.upper()
        with self._lock:
            for trade in self.trades:
                if trade.market_id != market_id or trade.won is not None:
                    continue
                won = trade.side.upper() == winning_side
                payout = settlement_price if won else 0.0
                pnl = (payout - trade.price) * trade.shares
                trade.pnl_usd = pnl
                trade.won = won
                stats = self.systems.setdefault(trade.system, SystemStats())
                stats.pnl_usd += pnl
                if won:
                    stats.wins += 1
                else:
                    stats.losses += 1
                resolved.append(trade)
            if resolved:
                self._persist()
        return resolved

    def summary(self) -> dict[str, Any]:
        systems = BenchmarkSystems(
            a=self._stats_for("a"),
            b=self._stats_for("b"),
            c=self._stats_for("c"),
        )
        return BenchmarkResponse(systems=systems, total_trades=len(self.trades)).model_dump()

    def _stats_for(self, key: str) -> SystemBenchmarkStats:
        stats = self.systems.get(key, SystemStats())
        return SystemBenchmarkStats(
            pnl_usd=round(stats.pnl_usd, 4),
            trades=stats.trades,
            wins=stats.wins,
            losses=stats.losses,
            win_rate=round(stats.win_rate, 4),
        )
