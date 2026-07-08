import { strategies } from "../strategies";
import { MarketSnapshot } from "../strategies/types";

// Replays a sequence of historical snapshots through the exact same strategy
// functions used live. This is the whole point of the shared Strategy
// interface: nothing here is strategy-specific, so a strategy written once
// works in both live and simulation mode automatically.

export interface BacktestResult {
  strategyId: string;
  trades: number;
  wins: number;
  winRate: number;
  history: { timestamp: number; direction: string; confidence: number }[];
}

/**
 * @param snapshots historical ticks for ONE 5-min window, in chronological order
 * @param finalOutcome "YES" | "NO" -- how that window actually resolved
 */
export function runBacktestOnWindow(
  snapshots: MarketSnapshot[],
  finalOutcome: "YES" | "NO"
): BacktestResult[] {
  return strategies.map((strategy) => {
    let trades = 0;
    let wins = 0;
    const history: BacktestResult["history"] = [];
    let lastDirection: string | null = null;

    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      const pastHistory = { snapshots: snapshots.slice(0, i + 1) };
      const signal = strategy.evaluate(snapshot, pastHistory);

      history.push({
        timestamp: snapshot.timestamp,
        direction: signal.direction,
        confidence: signal.confidence,
      });

      // Count it as a "trade" the moment the strategy changes into a
      // non-neutral direction (mirrors how the live worker only logs
      // direction changes, so live and backtest counts are comparable).
      if (signal.direction !== "NEUTRAL" && signal.direction !== lastDirection) {
        trades++;
        if (signal.direction === "BOTH" || signal.direction === finalOutcome) {
          wins++; // arbitrage ("BOTH") always wins by construction
        }
      }
      if (signal.direction !== "NEUTRAL") lastDirection = signal.direction;
    }

    return {
      strategyId: strategy.id,
      trades,
      wins,
      winRate: trades > 0 ? wins / trades : 0,
      history,
    };
  });
}

/**
 * Runs the backtest across many historical windows and aggregates per-strategy
 * stats -- this is what gets saved as a BacktestRun row.
 */
export function runBacktestOnManyWindows(
  windows: { snapshots: MarketSnapshot[]; finalOutcome: "YES" | "NO" }[]
) {
  const totals = new Map<string, { trades: number; wins: number }>();

  for (const window of windows) {
    const results = runBacktestOnWindow(window.snapshots, window.finalOutcome);
    for (const r of results) {
      const prev = totals.get(r.strategyId) ?? { trades: 0, wins: 0 };
      totals.set(r.strategyId, {
        trades: prev.trades + r.trades,
        wins: prev.wins + r.wins,
      });
    }
  }

  const summary: Record<string, { trades: number; wins: number; winRate: number }> = {};
  for (const [strategyId, t] of totals) {
    summary[strategyId] = { ...t, winRate: t.trades > 0 ? t.wins / t.trades : 0 };
  }
  return summary;
}
