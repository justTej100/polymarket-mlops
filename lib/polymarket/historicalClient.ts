import { MarketSnapshot } from "../strategies/types";

// Historical tick data for backtesting. Polymarket's Data API / CLOB REST
// endpoints expose price history per token, but the exact route + pagination
// shape is worth re-confirming against current docs before wiring this up for
// real (docs.polymarket.com -> Data API). This function is the single seam
// to swap in a real fetch once that's nailed down -- everything downstream
// (backtestRunner, simulation page) just consumes MarketSnapshot[] and
// doesn't care where they came from.

export interface HistoricalWindow {
  conditionId: string;
  priceToBeat: number;
  finalOutcome: "YES" | "NO";
  snapshots: MarketSnapshot[];
}

export async function fetchHistoricalWindow(
  conditionId?: string
): Promise<HistoricalWindow> {
  // TODO: replace with a real call once the historical price-history endpoint
  // is confirmed, e.g.:
  //   GET https://clob.polymarket.com/prices-history?market={tokenId}&interval=...
  // For now this throws so the API route can fall back to a clearly-labeled
  // synthetic window rather than silently faking real market data.
  throw new Error(
    "fetchHistoricalWindow is not wired to a real endpoint yet -- see TODO in historicalClient.ts"
  );
}
