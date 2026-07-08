import { Strategy } from "./types";

// Buys ultra-cheap tokens (long-shot bets) when the payout-to-cost ratio is
// large enough to be worth the low win probability -- classic "lottery ticket" bet.
const ENTRY_THRESHOLD = 0.05; // consider tokens priced under 5c

export const lotteryTicket: Strategy = {
  id: "lottery-ticket",
  name: "Lottery Ticket",
  description:
    "Buys the cheap side (under 5c) when it's deep out-of-the-money late in the window. Small stake, big payout if it hits -- low win rate by design, sized so wins cover many losses.",
  evaluate: (snapshot) => {
    const { yesPrice, noPrice, secondsRemaining } = snapshot;

    // Only interesting once we're past the halfway point of the window --
    // early cheap prices are just normal uncertainty, not a long-shot.
    if (secondsRemaining > 150) {
      return { direction: "NEUTRAL", confidence: 0, note: "Too early in window" };
    }

    if (yesPrice <= ENTRY_THRESHOLD) {
      return {
        direction: "YES",
        confidence: 1 - yesPrice, // cheaper = juicier payout if it hits
        note: `YES at ${(yesPrice * 100).toFixed(1)}c, late window long-shot`,
      };
    }
    if (noPrice <= ENTRY_THRESHOLD) {
      return {
        direction: "NO",
        confidence: 1 - noPrice,
        note: `NO at ${(noPrice * 100).toFixed(1)}c, late window long-shot`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No side cheap enough" };
  },
};
