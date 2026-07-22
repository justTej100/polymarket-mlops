import { MarketHistory, MarketSnapshot } from "./types";

export const WINDOW_SECONDS = 300;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Buy-side price for the Up token (falls back to midpoint in backtests). */
export function upAskOf(s: MarketSnapshot): number {
  return s.upAsk ?? s.yesPrice;
}

/** Buy-side price for the Down token (falls back to midpoint in backtests). */
export function downAskOf(s: MarketSnapshot): number {
  return s.downAsk ?? s.noPrice;
}

/** Seconds elapsed since this 5-minute window opened. */
export function elapsedSeconds(s: MarketSnapshot): number {
  return WINDOW_SECONDS - s.secondsRemaining;
}

export function cents(price: number): string {
  return `${(price * 100).toFixed(1)}¢`;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/**
 * Resample the snapshot stream into fixed-width time bars (last value wins
 * within each bar). Used to run indicators on e.g. 5-second bars regardless
 * of how fast snapshots arrive.
 */
export function resampleBars(
  history: MarketHistory,
  barSeconds: number,
  pick: (s: MarketSnapshot) => number
): number[] {
  const snaps = history.snapshots;
  if (snaps.length === 0) return [];
  const barMs = barSeconds * 1000;
  const bars: number[] = [];
  let currentBucket = Math.floor(snaps[0].timestamp / barMs);
  let lastValue = pick(snaps[0]);
  for (const snap of snaps) {
    const bucket = Math.floor(snap.timestamp / barMs);
    while (bucket > currentBucket) {
      bars.push(lastValue); // carry forward through empty buckets
      currentBucket++;
    }
    lastValue = pick(snap);
  }
  bars.push(lastValue);
  return bars;
}

/** Classic RSI on a bar series; null if there aren't enough bars. */
export function rsi(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (gains + losses === 0) return 50;
  return (100 * gains) / (gains + losses);
}

/**
 * Percentage move of a field over the trailing `seconds` (earliest in-range
 * snapshot vs the latest). Null when history doesn't reach back that far.
 */
export function pctMoveOver(
  history: MarketHistory,
  seconds: number,
  pick: (s: MarketSnapshot) => number | undefined
): number | null {
  const snaps = history.snapshots;
  if (snaps.length < 2) return null;
  const last = snaps[snaps.length - 1];
  const cutoff = last.timestamp - seconds * 1000;
  const ref = snaps.find((s) => s.timestamp >= cutoff && pick(s) !== undefined);
  const from = ref ? pick(ref) : undefined;
  const to = pick(last);
  if (from === undefined || to === undefined || from === 0) return null;
  if (ref === snaps[snaps.length - 1]) return null;
  return (to - from) / from;
}

/**
 * Largest BTC move over any trailing-10s slice within the last `seconds`.
 * Returns the most negative (dump) and most positive (pump) 10s move seen.
 */
export function sharpestMoveWithin(
  history: MarketHistory,
  seconds: number,
  sliceSeconds = 10
): { maxDrop: number; maxPump: number } {
  const snaps = history.snapshots;
  let maxDrop = 0;
  let maxPump = 0;
  if (snaps.length < 2) return { maxDrop, maxPump };
  const cutoff = snaps[snaps.length - 1].timestamp - seconds * 1000;
  let j = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].timestamp < cutoff) continue;
    while (snaps[i].timestamp - snaps[j].timestamp > sliceSeconds * 1000) j++;
    const move = (snaps[i].currentPrice - snaps[j].currentPrice) / snaps[j].currentPrice;
    if (move < maxDrop) maxDrop = move;
    if (move > maxPump) maxPump = move;
  }
  return { maxDrop, maxPump };
}
