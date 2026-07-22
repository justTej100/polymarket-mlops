import { MarketSnapshot, Signal, Strategy } from "./types";
import { cents, elapsedSeconds } from "./helpers";

// Strategy 7 -- Fibonacci Levels on the token price.
// Anchor a fib grid to the swing high/low of the token's first 90 seconds,
// buy dips into the 23.6-61.8% retracement zone, take profit at the 127.2%
// extension (capped -- binary payoff tops out at $1).
const OBSERVE_SECONDS = 90;
const MIN_TIME_REMAINING = 90;
const MIN_SWING_RANGE = 0.06; // need a >=6c swing for levels to mean anything
const INVALIDATION_BUFFER = 0.02;
const EXTENSION = 0.272; // 127.2% extension beyond the swing high
const EXTENSION_CAP = 0.9; // above 90c this becomes 99c-Sniper territory

function evaluateSwing(
  series: number[],
  currentPrice: number,
  direction: "YES" | "NO",
  label: string
): Signal | null {
  const hi = Math.max(...series);
  const lo = Math.min(...series);
  const range = hi - lo;
  if (range < MIN_SWING_RANGE) return null;

  if (currentPrice < lo - INVALIDATION_BUFFER) {
    return { direction: "NEUTRAL", confidence: 0, note: `Swing low broken on ${label} — setup invalidated` };
  }

  const zoneBottom = hi - 0.618 * range; // deepest retracement we'll buy
  const target = Math.min(hi + EXTENSION * range, EXTENSION_CAP);

  if (currentPrice >= target) {
    return { direction: "NEUTRAL", confidence: 0, note: `${label} hit the 127.2% extension target (${cents(target)}) — profit taken` };
  }
  if (currentPrice >= zoneBottom) {
    return {
      direction,
      confidence: 0.55,
      note: `${label} in fib zone of the ${cents(range)} swing (${cents(zoneBottom)}–${cents(hi)}), target ${cents(target)}`,
    };
  }
  return { direction: "NEUTRAL", confidence: 0, note: `${label} below the 61.8% retracement — waiting` };
}

export const fibonacci: Strategy = {
  id: "fibonacci",
  name: "Fibonacci Levels",
  description:
    "Observes the token price for the first 90 seconds, anchors Fibonacci retracements to that swing's high/low, then buys dips into the 23.6-61.8% zone of the dominant side. Takes profit at the 127.2% extension (capped at 90¢), and invalidates the whole setup if the swing low breaks. Won't stage entries in the last 90 seconds.",
  evaluate: (snapshot: MarketSnapshot, history) => {
    const elapsed = elapsedSeconds(snapshot);
    if (elapsed < OBSERVE_SECONDS) {
      return { direction: "NEUTRAL", confidence: 0, note: "Observing the first 90s swing" };
    }
    if (snapshot.secondsRemaining < MIN_TIME_REMAINING) {
      return { direction: "NEUTRAL", confidence: 0, note: "Under 90s left — no time to manage entries" };
    }

    const windowOpenMs = snapshot.timestamp - elapsed * 1000;
    const observed = history.snapshots.filter(
      (s) => s.timestamp <= windowOpenMs + OBSERVE_SECONDS * 1000
    );
    if (observed.length < 10) {
      return { direction: "NEUTRAL", confidence: 0, note: "Not enough history from the observation window" };
    }

    // Run the grid on whichever side rallied during the observation window.
    const yesSeries = observed.map((s) => s.yesPrice);
    const upSwing = yesSeries[yesSeries.length - 1] >= yesSeries[0];
    const signal = upSwing
      ? evaluateSwing(yesSeries, snapshot.yesPrice, "YES", "Up")
      : evaluateSwing(observed.map((s) => s.noPrice), snapshot.noPrice, "NO", "Down");

    return signal ?? { direction: "NEUTRAL", confidence: 0, note: "First-90s swing too small (<6¢) for fib levels" };
  },
};
