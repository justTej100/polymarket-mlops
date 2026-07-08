import { Strategy } from "./types";

// Reacts to sudden, sharp price dumps (or pumps) in the underlying within a
// very short lookback -- these often overshoot briefly before the order book
// catches up, creating a short-lived mispricing to fade.
const LOOKBACK_TICKS = 5;
const DUMP_THRESHOLD = 0.0015; // ~0.15% move within the lookback counts as a "dump"

export const dumpHedgeArb: Strategy = {
  id: "dump-hedge-arb",
  name: "Dump-Hedge Arbitrage",
  description:
    "Watches for sudden sharp price moves (dumps or pumps) over the last few ticks. These often overshoot briefly before the order book re-prices, so this fades the move -- betting on a short-term reversion.",
  evaluate: (snapshot, history) => {
    const recent = history.snapshots.slice(-LOOKBACK_TICKS);
    if (recent.length < LOOKBACK_TICKS) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough recent ticks" };
    }

    const start = recent[0].currentPrice;
    const end = snapshot.currentPrice;
    const move = (end - start) / start;

    if (move <= -DUMP_THRESHOLD) {
      // Sharp dump -- fade it, bet YES (reversion up) on the token
      return {
        direction: "YES",
        confidence: Math.min(Math.abs(move) / (DUMP_THRESHOLD * 3), 1),
        note: `Fading a ${(move * 100).toFixed(2)}% dump over ${LOOKBACK_TICKS} ticks`,
      };
    }
    if (move >= DUMP_THRESHOLD) {
      // Sharp pump -- fade it, bet NO (reversion down)
      return {
        direction: "NO",
        confidence: Math.min(Math.abs(move) / (DUMP_THRESHOLD * 3), 1),
        note: `Fading a ${(move * 100).toFixed(2)}% pump over ${LOOKBACK_TICKS} ticks`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No sudden move to fade" };
  },
};
