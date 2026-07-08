import { Strategy } from "./types";

// Classic technical-analysis retracement levels applied to the BTC spot price
// over the current window's recent swing high/low. If price pulls back to the
// 61.8% level and looks like it's holding, bet on continuation of the prior move.
const FIB_LEVEL = 0.618;
const TOLERANCE = 0.0015; // how close price needs to be to the level (as % of range)

export const fibRetracement: Strategy = {
  id: "fib-retracement",
  name: "Fibonacci Retracement",
  description:
    "Finds the recent swing high/low in this window and checks if price has pulled back to the 61.8% retracement level. If it's holding there, bets the original move continues.",
  evaluate: (snapshot, history) => {
    const recent = history.snapshots.slice(-30); // recent window of ticks
    if (recent.length < 5) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough history yet" };
    }

    const prices = recent.map((s) => s.currentPrice);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;
    if (range === 0) {
      return { direction: "NEUTRAL", confidence: 0, note: "No price movement to measure" };
    }

    const price = snapshot.currentPrice;
    const movingUp = prices[prices.length - 1] > prices[0];

    const fibLevelPrice = movingUp
      ? high - range * FIB_LEVEL // pulled back from the high
      : low + range * FIB_LEVEL; // pulled back up from the low

    const distance = Math.abs(price - fibLevelPrice) / range;

    if (distance <= TOLERANCE) {
      return {
        direction: movingUp ? "YES" : "NO",
        confidence: 1 - distance / TOLERANCE,
        note: `Holding at 61.8% retracement of ${movingUp ? "upswing" : "downswing"}`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "Not at a retracement level" };
  },
};
