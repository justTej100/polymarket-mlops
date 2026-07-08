// Shared contract every strategy implements. Both the live worker (fed by the
// Polymarket WebSocket) and the backtest runner (fed by historical data) call
// this exact same function shape -- so a strategy behaves identically whether
// it's running against real-time data or a historical replay.

export type Direction = "YES" | "NO" | "BOTH" | "NEUTRAL";
// "BOTH" is for arbitrage-style strategies that buy both sides at once --
// the UI renders it as a box straddling the baseline rather than in the
// green or red zone.

/** A single point-in-time view of one 5-minute BTC Up/Down market. */
export interface MarketSnapshot {
  conditionId: string;
  asset: "BTC";
  priceToBeat: number;      // the strike price for this window
  currentPrice: number;     // current BTC spot price
  yesPrice: number;         // current YES token price (0-1)
  noPrice: number;          // current NO token price (0-1)
  yesBidAskSpread: number;
  secondsRemaining: number; // seconds left in the 5-min window
  timestamp: number;        // ms epoch
  volume24h?: number;
}

/** Rolling history a strategy can look back over (most recent last). */
export interface MarketHistory {
  snapshots: MarketSnapshot[]; // recent snapshots for this market/asset
}

export interface Signal {
  direction: Direction;
  confidence: number;   // 0-1, how strongly the strategy believes this
  note: string;         // short human-readable reason, shown in the UI
}

export interface Strategy {
  id: string;           // stable slug, e.g. "lottery-ticket"
  name: string;         // display name
  description: string;  // shown in the explainer panel under the chart
  evaluate: (snapshot: MarketSnapshot, history: MarketHistory) => Signal;
}
