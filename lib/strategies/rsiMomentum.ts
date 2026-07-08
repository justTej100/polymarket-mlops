import { Strategy } from "./types";

// Fast RSI (7-period, tuned for a 5-min window rather than the standard 14)
// on the spot price. Overbought/oversold readings bet on mean-reversion.
const PERIOD = 7;
const OVERBOUGHT = 70;
const OVERSOLD = 30;

function rsi(prices: number[], period: number): number | null {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-period);
  const gains = recent.filter((c) => c > 0);
  const losses = recent.filter((c) => c < 0).map((c) => -c);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export const rsiMomentum: Strategy = {
  id: "rsi-momentum",
  name: "RSI Momentum",
  description:
    "Fast 7-period RSI on the spot price. Reads over 70 (overbought) bet NO on a pullback; reads under 30 (oversold) bet YES on a bounce.",
  evaluate: (_snapshot, history) => {
    const prices = history.snapshots.map((s) => s.currentPrice);
    const value = rsi(prices, PERIOD);

    if (value === null) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough history for RSI" };
    }
    if (value >= OVERBOUGHT) {
      return {
        direction: "NO",
        confidence: Math.min((value - OVERBOUGHT) / 30, 1),
        note: `RSI ${value.toFixed(0)}, overbought`,
      };
    }
    if (value <= OVERSOLD) {
      return {
        direction: "YES",
        confidence: Math.min((OVERSOLD - value) / 30, 1),
        note: `RSI ${value.toFixed(0)}, oversold`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: `RSI ${value.toFixed(0)}, neutral zone` };
  },
};
