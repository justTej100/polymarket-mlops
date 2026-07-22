import { Strategy } from "./types";
import { cents, clamp, downAskOf, elapsedSeconds, upAskOf } from "./helpers";

// Strategy 4 -- Pre-Order Market (Queue Positioning).
// The spec places resting 45c bids on the NEXT window before it opens; in
// this signal engine the equivalent is trading the first seconds of a fresh
// window, while the book is still empty and both sides trade at a discount
// before the midpoint is discovered.
const OPENING_SECONDS = 45;
const SIDE_MIN = 0.3;
const SIDE_MAX = 0.6;
const MAX_COMBINED_COST = 0.97;

export const preOrderOpen: Strategy = {
  id: "pre-order-open",
  name: "Pre-Order (Opening Book)",
  description:
    "Queue positioning: whoever has orders in when a new window opens gets the empty book's first (best) prices. Fires only in the first 45 seconds, when both sides sit in the 30-60¢ band and together cost under 97¢ — buying the pair before equilibrium is found captures the opening discount.",
  evaluate: (snapshot) => {
    if (elapsedSeconds(snapshot) > OPENING_SECONDS) {
      return { direction: "NEUTRAL", confidence: 0, note: "Opening window passed — waiting for next market" };
    }

    const upAsk = upAskOf(snapshot);
    const downAsk = downAskOf(snapshot);
    const combined = upAsk + downAsk;
    const inBand = (p: number) => p >= SIDE_MIN && p <= SIDE_MAX;

    if (inBand(upAsk) && inBand(downAsk) && combined <= MAX_COMBINED_COST) {
      return {
        direction: "BOTH",
        confidence: clamp((1 - combined) * 8, 0.3, 1),
        note: `Fresh book: ${cents(upAsk)} + ${cents(downAsk)} = ${cents(combined)} before midpoint discovery`,
      };
    }

    return { direction: "NEUTRAL", confidence: 0, note: "Opening book already efficient or one-sided" };
  },
};
