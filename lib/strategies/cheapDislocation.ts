import { Strategy } from "./types";
import { cents, downAskOf, elapsedSeconds, upAskOf } from "./helpers";

// Strategy 1 -- 1c Buy (Ultra-Cheap Dislocation), in three flavors.
// Same playbook, different definition of "cheap": wait ~45s for the market's
// initial direction to form, buy the underdog side below the entry threshold,
// then either take profit when it reprices or collect the full $1 on a true
// reversal. Running the <5c / <30c / <40c versions side by side shows where
// the underdog edge actually lives.
const ENTRY_DELAY_SECONDS = 45;

function makeLotteryVariant(opts: {
  id: string;
  name: string;
  description: string;
  entryMax: number;
  takeProfit: number;
}): Strategy {
  const { entryMax, takeProfit } = opts;
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    evaluate: (snapshot) => {
      if (elapsedSeconds(snapshot) < ENTRY_DELAY_SECONDS) {
        return { direction: "NEUTRAL", confidence: 0, note: "Letting initial direction form (first 45s)" };
      }

      const upAsk = upAskOf(snapshot);
      const downAsk = downAskOf(snapshot);

      // Only one side can be the underdog -- buy the cheaper one if it's in range.
      if (upAsk <= entryMax && upAsk < downAsk) {
        return {
          direction: "YES",
          confidence: 0.3,
          note: `Up at ${cents(upAsk)} — underdog bid, ${(1 / upAsk).toFixed(1)}x if it reverses`,
        };
      }
      if (downAsk <= entryMax && downAsk < upAsk) {
        return {
          direction: "NO",
          confidence: 0.3,
          note: `Down at ${cents(downAsk)} — underdog bid, ${(1 / downAsk).toFixed(1)}x if it reverses`,
        };
      }

      // Hold zone: a ticket bought below the threshold that has repriced
      // toward the take-profit tier is still working -- keep it until then.
      const cheapSide = snapshot.yesPrice <= snapshot.noPrice ? "YES" : "NO";
      const cheapPrice = Math.min(snapshot.yesPrice, snapshot.noPrice);
      if (cheapPrice > entryMax && cheapPrice < takeProfit) {
        return {
          direction: cheapSide,
          confidence: 0.3,
          note: `Holding underdog at ${cents(cheapPrice)} — take profit at ${cents(takeProfit)}`,
        };
      }
      if (cheapPrice >= takeProfit) {
        return { direction: "NEUTRAL", confidence: 0, note: `Underdog hit ${cents(takeProfit)} — profit taken` };
      }

      return { direction: "NEUTRAL", confidence: 0, note: `No side cheap enough (need ≤${cents(entryMax)})` };
    },
  };
}

export const lottery5c = makeLotteryVariant({
  id: "lottery-5c",
  name: "Lottery <5¢",
  description:
    "The pure lottery ticket: after the first 45s, buys any side under 5¢ — priced as if reversals never happen. Takes profit if the fallen side reprices to 12¢ (a 3-10x), or collects the full $1 on a true reversal. Small stakes: one winner pays for many duds.",
  entryMax: 0.05,
  takeProfit: 0.12,
});

export const lottery30c = makeLotteryVariant({
  id: "lottery-30c",
  name: "Lottery <30¢",
  description:
    "Mid-priced underdog version: buys the losing side under 30¢ after the first 45s. Less payoff per hit than the <5¢ ticket (about 3x at full reversal) but fills far more often. Takes profit when the underdog reprices to 45¢ — nearly back to a coin flip.",
  entryMax: 0.3,
  takeProfit: 0.45,
});

export const lottery40c = makeLotteryVariant({
  id: "lottery-40c",
  name: "Lottery <40¢",
  description:
    "The tamest underdog version: buys any side under 40¢ after the first 45s — barely a dislocation, more a slight-favorite fade. Takes profit at 50¢ (back to even odds). Fills constantly; side by side with the <30¢ and <5¢ versions it shows where the underdog edge actually lives.",
  entryMax: 0.4,
  takeProfit: 0.5,
});
