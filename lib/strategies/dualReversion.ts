import { Strategy } from "./types";
import { cents, clamp, downAskOf, upAskOf } from "./helpers";

// Strategy 3 -- Low-Side Dual Reversion.
// Up and Down must sum to $1.00 at settlement. When BOTH sides can be bought
// for 30-48c each (combined under 98c), buying the pair locks in the gap no
// matter which side wins.
const MAX_ASK_EITHER_SIDE = 0.48;
const MIN_ASK_EITHER_SIDE = 0.3;
const MAX_COMBINED_COST = 0.98;
const MIN_TIME_REMAINING = 120;

export const dualReversion: Strategy = {
  id: "dual-reversion",
  name: "Low-Side Dual Reversion",
  description:
    "When both sides are compressed into the 30-48¢ band and together cost under 98¢, it buys both. One side must pay $1 at settlement, so the discount is locked profit regardless of direction. Only enters with 2+ minutes left, while the book is still finding its midpoint.",
  evaluate: (snapshot) => {
    if (snapshot.secondsRemaining < MIN_TIME_REMAINING) {
      return { direction: "NEUTRAL", confidence: 0, note: "Under 2 min left — asymmetric fill risk" };
    }

    const upAsk = upAskOf(snapshot);
    const downAsk = downAskOf(snapshot);
    const combined = upAsk + downAsk;
    const hi = Math.max(upAsk, downAsk);
    const lo = Math.min(upAsk, downAsk);

    if (hi <= MAX_ASK_EITHER_SIDE && lo >= MIN_ASK_EITHER_SIDE && combined <= MAX_COMBINED_COST) {
      return {
        direction: "BOTH",
        confidence: clamp((1 - combined) * 6, 0.3, 1),
        note: `${cents(upAsk)} + ${cents(downAsk)} = ${cents(combined)} for a guaranteed $1 — ${cents(1 - combined)} locked`,
      };
    }

    return { direction: "NEUTRAL", confidence: 0, note: "Book not compressed (need both sides 30-48¢)" };
  },
};
