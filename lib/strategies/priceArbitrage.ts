import { Strategy } from "./types";

// YES + NO should sum to ~1.00 (minus fees). If they're compressed below that
// (e.g. 0.47 + 0.48 = 0.95) buying both sides locks in a small risk-free profit
// at resolution, regardless of outcome.
const ARBITRAGE_MARGIN = 0.02; // require at least 2c of edge to bother

export const priceArbitrage: Strategy = {
  id: "price-arbitrage",
  name: "Price Arbitrage",
  description:
    "Watches for YES + NO summing to noticeably less than $1. When it does, buying both sides locks in a small guaranteed profit no matter which way the market resolves.",
  evaluate: (snapshot) => {
    const { yesPrice, noPrice } = snapshot;
    const total = yesPrice + noPrice;
    const gap = 1 - total;

    if (gap >= ARBITRAGE_MARGIN) {
      return {
        direction: "BOTH", // this strategy buys BOTH sides, not one
        confidence: Math.min(gap * 10, 1),
        note: `YES+NO = ${total.toFixed(3)}, ${(gap * 100).toFixed(1)}c of arb edge -- buy both`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No compression, prices sum to ~$1" };
  },
};
