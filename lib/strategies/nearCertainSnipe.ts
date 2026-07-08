import { Strategy } from "./types";

// Snipes tokens trading near 99c very late in the window -- the market is
// nearly certain, and there's often a sliver of edge left uncollected right
// before resolution.
const SNIPE_PRICE = 0.97;
const MAX_SECONDS_REMAINING = 20;

export const nearCertainSnipe: Strategy = {
  id: "near-certain-snipe",
  name: "Near-Certain Snipe",
  description:
    "In the last ~20 seconds, buys whichever side is trading above 97c. The outcome is nearly locked in, so this collects the last few cents of remaining edge before resolution.",
  evaluate: (snapshot) => {
    const { yesPrice, noPrice, secondsRemaining } = snapshot;

    if (secondsRemaining > MAX_SECONDS_REMAINING) {
      return { direction: "NEUTRAL", confidence: 0, note: "Waiting for window close" };
    }

    if (yesPrice >= SNIPE_PRICE) {
      return {
        direction: "YES",
        confidence: yesPrice,
        note: `YES at ${(yesPrice * 100).toFixed(1)}c with ${secondsRemaining}s left`,
      };
    }
    if (noPrice >= SNIPE_PRICE) {
      return {
        direction: "NO",
        confidence: noPrice,
        note: `NO at ${(noPrice * 100).toFixed(1)}c with ${secondsRemaining}s left`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No side near-certain yet" };
  },
};
