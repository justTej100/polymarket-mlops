import { MarketSnapshot } from "../strategies/types";
import { HistoricalWindow } from "./historicalClient";

// Clearly-labeled synthetic data so the simulation page has something to run
// against locally before the real historical endpoint (see historicalClient.ts)
// is wired up. Generates a random-walk BTC price over a 5-min window and
// derives YES/NO prices from a simple logistic function of the walk vs. the
// price-to-beat -- rough, but shaped enough for the 9 strategies to react to.
export function generateSyntheticWindow(): HistoricalWindow {
  const TICKS = 150; // one tick per 2 seconds over 5 minutes
  const priceToBeat = 65000 + Math.round((Math.random() - 0.5) * 200);
  let price = priceToBeat;

  const snapshots: MarketSnapshot[] = [];
  const start = Date.now() - TICKS * 2000;

  for (let i = 0; i < TICKS; i++) {
    price += (Math.random() - 0.5) * 15; // small random walk step
    const secondsRemaining = Math.max(0, 300 - i * 2);
    const diff = price - priceToBeat;
    const yesPrice = Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-diff / 20))));

    snapshots.push({
      conditionId: "synthetic-demo-window",
      asset: "BTC",
      priceToBeat,
      currentPrice: Math.round(price * 100) / 100,
      yesPrice: Math.round(yesPrice * 1000) / 1000,
      noPrice: Math.round((1 - yesPrice) * 1000) / 1000,
      yesBidAskSpread: 0.01,
      secondsRemaining,
      timestamp: start + i * 2000,
      volume24h: 500_000,
    });
  }

  const finalOutcome: "YES" | "NO" = price >= priceToBeat ? "YES" : "NO";

  return {
    conditionId: "synthetic-demo-window",
    priceToBeat,
    finalOutcome,
    snapshots,
  };
}
