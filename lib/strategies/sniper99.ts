import { Strategy } from "./types";
import { cents, downAskOf, upAskOf } from "./helpers";

// Strategy 2 -- 99c Sniper (Near-Resolution Strike).
// In the final minute, when spot is clearly past the strike, the winning side
// often still asks 97-99c instead of $1.00. Buying that gap is a near-arb --
// the tail risk is a last-second candle flipping the outcome.
const MAX_TIME_REMAINING = 60;
const MIN_DISTANCE_PCT = 0.001; // spot must be >=0.1% past the strike (~$100 on BTC)
const MAX_ASK = 0.99;
const MIN_ASK = 0.9; // if the book prices the "winner" below 90c, it disagrees with spot -- stay out

export const sniper99: Strategy = {
  id: "sniper-99c",
  name: "99¢ Sniper",
  description:
    "Fires only in the final 60 seconds, and only when BTC is decisively past the strike (≥0.1% away) while the winning side still asks ≤99¢. Buys the near-certain winner for the last 1-3¢ of edge and holds to settlement. Low variance — the rare killer is a last-second candle through the strike.",
  evaluate: (snapshot) => {
    const { secondsRemaining, currentPrice, priceToBeat } = snapshot;

    if (secondsRemaining > MAX_TIME_REMAINING) {
      return { direction: "NEUTRAL", confidence: 0, note: "Only fires in the final 60s" };
    }

    const distance = currentPrice - priceToBeat;
    if (Math.abs(distance) / priceToBeat < MIN_DISTANCE_PCT) {
      return { direction: "NEUTRAL", confidence: 0, note: "Spot too close to strike — flip risk too high" };
    }

    const winningSide = distance >= 0 ? "YES" : "NO";
    const ask = winningSide === "YES" ? upAskOf(snapshot) : downAskOf(snapshot);

    if (ask > MAX_ASK) {
      return { direction: "NEUTRAL", confidence: 0, note: `No discount left (winner asks ${cents(ask)})` };
    }
    if (ask < MIN_ASK) {
      return { direction: "NEUTRAL", confidence: 0, note: "Book disagrees with spot — skipping" };
    }

    return {
      direction: winningSide,
      confidence: 0.9,
      note: `${winningSide === "YES" ? "Up" : "Down"} at ${cents(ask)} with $${Math.abs(distance).toFixed(0)} of cushion, ${secondsRemaining}s left`,
    };
  },
};
