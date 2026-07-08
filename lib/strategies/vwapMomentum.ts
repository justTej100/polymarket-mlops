import { Strategy } from "./types";

// Volume-weighted average price for the window. Price trading meaningfully
// above VWAP suggests buyers are in control (lean YES); meaningfully below
// suggests sellers are in control (lean NO).
const DEVIATION_THRESHOLD = 0.0008; // ~0.08% away from VWAP to count as a signal

export const vwapMomentum: Strategy = {
  id: "vwap-momentum",
  name: "VWAP Momentum",
  description:
    "Tracks volume-weighted average price for the current window. Price sustaining above VWAP leans YES (buyers in control); sustaining below leans NO.",
  evaluate: (snapshot, history) => {
    const recent = history.snapshots.slice(-30);
    if (recent.length < 5) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough history for VWAP" };
    }

    let cumPV = 0;
    let cumV = 0;
    for (const s of recent) {
      const vol = s.volume24h ? s.volume24h / 288 : 1; // rough per-tick proxy if no better volume feed
      cumPV += s.currentPrice * vol;
      cumV += vol;
    }
    const vwap = cumPV / cumV;
    const deviation = (snapshot.currentPrice - vwap) / vwap;

    if (deviation >= DEVIATION_THRESHOLD) {
      return {
        direction: "YES",
        confidence: Math.min(deviation / (DEVIATION_THRESHOLD * 4), 1),
        note: `Price ${(deviation * 100).toFixed(2)}% above VWAP`,
      };
    }
    if (deviation <= -DEVIATION_THRESHOLD) {
      return {
        direction: "NO",
        confidence: Math.min(Math.abs(deviation) / (DEVIATION_THRESHOLD * 4), 1),
        note: `Price ${(deviation * 100).toFixed(2)}% below VWAP`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "Trading near VWAP" };
  },
};
