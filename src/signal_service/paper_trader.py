"""Paper order simulator with DRY_RUN, caps, and session kill switch."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

from src.signal_service.benchmark import BenchmarkStore, TradeRecord

load_dotenv()

DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"
SESSION_BUDGET = float(os.getenv("SESSION_BUDGET_USD", "1000"))
SESSION_KILL_PCT = float(os.getenv("SESSION_DRAWDOWN_KILL_PCT", "0.10"))
MAX_NOTIONAL_PER_ORDER = float(os.getenv("MAX_NOTIONAL_PER_ORDER_USD", "100"))


@dataclass
class PaperOrderSimulator:
    benchmark: BenchmarkStore
    dry_run: bool = DRY_RUN
    session_budget: float = SESSION_BUDGET
    kill_drawdown_pct: float = SESSION_KILL_PCT
    max_notional_per_order: float = MAX_NOTIONAL_PER_ORDER
    halted: bool = field(default=False, init=False)

    def _check_kill_switch(self) -> None:
        total_pnl = sum(s.pnl_usd for s in self.benchmark.systems.values())
        if total_pnl <= -(self.session_budget * self.kill_drawdown_pct):
            self.halted = True

    def execute(
        self,
        *,
        system: str,
        strategy_id: int | None,
        market_id: str,
        action: str,
        side: str,
        price: float,
        shares: float,
        confidence: float = 0.0,
        mode: str = "autonomous",
        max_notional: float | None = None,
    ) -> dict:
        self._check_kill_switch()
        if self.halted:
            return {"status": "rejected", "reason": "session_kill_switch", "dry_run": self.dry_run}

        notional = price * shares
        cap = max_notional or self.max_notional_per_order
        if notional > cap:
            shares = cap / price if price > 0 else 0
            notional = price * shares

        if shares <= 0 or price <= 0:
            return {"status": "rejected", "reason": "invalid_order", "dry_run": self.dry_run}

        trade = self.benchmark.record_trade(
            system=system,
            strategy_id=strategy_id,
            market_id=market_id,
            action=action,
            side=side,
            price=price,
            shares=shares,
            confidence=confidence,
            mode=mode,
            dry_run=self.dry_run,
        )

        return {
            "status": "accepted",
            "dry_run": self.dry_run,
            "trade_id": trade.trade_id,
            "notional_usd": round(trade.notional_usd, 4),
            "shares": shares,
        }

    def simulate_resolution(
        self,
        market_id: str,
        winning_side: str,
    ) -> list[TradeRecord]:
        return self.benchmark.resolve_market(market_id, winning_side)
