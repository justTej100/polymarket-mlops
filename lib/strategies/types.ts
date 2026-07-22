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
  priceToBeat: number;      // Chainlink BTC/USD price at window open (the strike)
  currentPrice: number;     // current Chainlink BTC/USD price
  yesPrice: number;         // Up token midpoint price (0-1)
  noPrice: number;          // Down token midpoint price (0-1)
  yesBidAskSpread: number;
  secondsRemaining: number; // seconds left in the 5-min window
  timestamp: number;        // ms epoch
  volume24h?: number;

  // Real order-book quotes from the Polymarket CLOB. Buy at the ask, sell at
  // the bid. Optional because synthetic/backtest windows may not carry a book.
  upBid?: number;
  upAsk?: number;
  downBid?: number;
  downAsk?: number;
  /** True while the strike price for this window hasn't been confirmed yet. */
  priceToBeatPending?: boolean;
  question?: string;        // e.g. "Bitcoin Up or Down - July 22, 2:30AM-2:35AM ET"
  /** Chainlink ETH/USD price at this moment -- used by cross-market lead-lag. */
  ethPrice?: number;
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
  id: string;           // stable slug, e.g. "sniper-99c"
  name: string;         // display name
  description: string;  // shown in the explainer panel under the chart
  evaluate: (snapshot: MarketSnapshot, history: MarketHistory) => Signal;
}
