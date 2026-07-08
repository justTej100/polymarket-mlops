import { Strategy } from "./types";

// MACD (12/26 EMA difference, 9-period signal line) on the BTC spot price
// within the window. A bullish crossover (MACD crosses above signal) leans
// YES; bearish crossover leans NO. Short windows mean shorter EMA periods
// than the traditional daily-chart 12/26/9.
const FAST = 6;
const SLOW = 13;
const SIGNAL = 5;

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export const macdMomentum: Strategy = {
  id: "macd-momentum",
  name: "MACD Momentum",
  description:
    "Runs a fast MACD (6/13 EMA, 5-period signal) on the spot price inside the window. A bullish crossover leans YES, a bearish crossover leans NO.",
  evaluate: (_snapshot, history) => {
    const prices = history.snapshots.map((s) => s.currentPrice);
    if (prices.length < SLOW + SIGNAL) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough history for MACD" };
    }

    const fastEma = ema(prices, FAST);
    const slowEma = ema(prices, SLOW);
    const macdLine = fastEma.map((v, i) => v - slowEma[i]);
    const signalLine = ema(macdLine, SIGNAL);

    const hist = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
    const prevHist =
      macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];

    const crossedUp = prevHist <= 0 && hist > 0;
    const crossedDown = prevHist >= 0 && hist < 0;

    if (crossedUp) {
      return { direction: "YES", confidence: Math.min(Math.abs(hist) * 50, 1), note: "Bullish MACD crossover" };
    }
    if (crossedDown) {
      return { direction: "NO", confidence: Math.min(Math.abs(hist) * 50, 1), note: "Bearish MACD crossover" };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No fresh crossover" };
  },
};
