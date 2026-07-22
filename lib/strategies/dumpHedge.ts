import { Signal, Strategy } from "./types";
import { cents, downAskOf, pctMoveOver, sharpestMoveWithin, upAskOf } from "./helpers";

// Strategy 9 -- Dump-Hedge (Sharp Move Arbitrage).
// A violent BTC move sends one side to near-zero while stale quotes linger on
// the other. Buy the collapsed side immediately; if the elevated side can
// still be had for a combined cost under 98c, hedge it for a locked edge.
// Otherwise run the collapsed leg naked as a reversal play.
const MOVE_PCT_THRESHOLD = 0.003; // 0.3% BTC move...
const MOVE_WINDOW_SECONDS = 10; // ...within 10 seconds
const MAX_ENTRY = 0.15; // collapsed side must still be cheap
const HEDGE_MAX_COMBINED = 0.98;
const HOLD_WINDOW_SECONDS = 120; // manage the position while the event is recent
const TAKE_PROFIT = 0.3; // naked leg exit once the reversal has repriced it
const STOP_LOSS = 0.04; // cut if the collapsed side keeps bleeding

function manageSide(
  collapsedAsk: number,
  otherAsk: number,
  direction: "YES" | "NO",
  fresh: boolean,
  movePct: number
): Signal | null {
  const label = direction === "YES" ? "Up" : "Down";
  const combined = collapsedAsk + otherAsk;

  if (fresh && collapsedAsk <= MAX_ENTRY) {
    if (combined <= HEDGE_MAX_COMBINED) {
      return {
        direction: "BOTH",
        confidence: 0.8,
        note: `Sharp move ${(movePct * 100).toFixed(2)}% in 10s — hedged pair at ${cents(combined)} locks ${cents(1 - combined)}`,
      };
    }
    return {
      direction,
      confidence: 0.45,
      note: `Sharp move ${(movePct * 100).toFixed(2)}% — ${label} collapsed to ${cents(collapsedAsk)}, hedge too dear, naked reversal leg`,
    };
  }

  // Post-event management while the move is still recent.
  if (collapsedAsk < STOP_LOSS) {
    return { direction: "NEUTRAL", confidence: 0, note: `No reversal — ${label} below ${cents(STOP_LOSS)}, cutting` };
  }
  if (collapsedAsk >= TAKE_PROFIT) {
    return { direction: "NEUTRAL", confidence: 0, note: `${label} recovered to ${cents(collapsedAsk)} — profit taken` };
  }
  if (collapsedAsk < TAKE_PROFIT) {
    if (otherAsk >= 0.75 && combined <= 1.0) {
      return { direction: "BOTH", confidence: 0.4, note: `Holding hedged pair post-move (${cents(combined)} combined)` };
    }
    return { direction, confidence: 0.35, note: `Holding ${label} reversal leg at ${cents(collapsedAsk)}, target ${cents(TAKE_PROFIT)}` };
  }
  return null;
}

export const dumpHedge: Strategy = {
  id: "dump-hedge",
  name: "Dump-Hedge",
  description:
    "Purely reactive: when BTC moves ≥0.3% inside 10 seconds and one side collapses under 15¢, it buys the fallen side instantly. If the elevated side is still available for a combined cost under 98¢ it hedges for a locked payout; otherwise it runs the leg naked, taking profit near 30¢ or cutting below 4¢. Never pre-positions.",
  evaluate: (snapshot, history) => {
    const fresh = pctMoveOver(history, MOVE_WINDOW_SECONDS, (s) => s.currentPrice) ?? 0;
    const recent = sharpestMoveWithin(history, HOLD_WINDOW_SECONDS, MOVE_WINDOW_SECONDS);
    const upAsk = upAskOf(snapshot);
    const downAsk = downAskOf(snapshot);

    // Dump: BTC fell, Up collapsed.
    if (recent.maxDrop <= -MOVE_PCT_THRESHOLD && upAsk < TAKE_PROFIT + 0.01) {
      const signal = manageSide(upAsk, downAsk, "YES", fresh <= -MOVE_PCT_THRESHOLD, recent.maxDrop);
      if (signal) return signal;
    }

    // Pump: BTC ripped, Down collapsed.
    if (recent.maxPump >= MOVE_PCT_THRESHOLD && downAsk < TAKE_PROFIT + 0.01) {
      const signal = manageSide(downAsk, upAsk, "NO", fresh >= MOVE_PCT_THRESHOLD, recent.maxPump);
      if (signal) return signal;
    }

    return { direction: "NEUTRAL", confidence: 0, note: "No sharp move detected — waiting" };
  },
};
