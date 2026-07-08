import { Strategy } from "./types";
import { macdMomentum } from "./macdMomentum";
import { rsiMomentum } from "./rsiMomentum";
import { vwapMomentum } from "./vwapMomentum";

// Confluence strategy: only fires when at least 2 of the 3 momentum
// indicators (MACD, RSI, VWAP) agree on direction. Fires less often than any
// one of them alone, but with higher conviction when it does.
const MIN_AGREEING = 2;

export const momentumStacking: Strategy = {
  id: "momentum-stacking",
  name: "Momentum Stacking",
  description:
    "Runs MACD, RSI, and VWAP momentum together and only signals when at least 2 of the 3 agree on direction -- trades confluence over any single indicator's noise.",
  evaluate: (snapshot, history) => {
    const votes = [macdMomentum, rsiMomentum, vwapMomentum].map((s) =>
      s.evaluate(snapshot, history)
    );

    const yesVotes = votes.filter((v) => v.direction === "YES");
    const noVotes = votes.filter((v) => v.direction === "NO");

    if (yesVotes.length >= MIN_AGREEING) {
      const avgConf = yesVotes.reduce((a, v) => a + v.confidence, 0) / yesVotes.length;
      return {
        direction: "YES",
        confidence: avgConf,
        note: `${yesVotes.length}/3 momentum signals agree YES`,
      };
    }
    if (noVotes.length >= MIN_AGREEING) {
      const avgConf = noVotes.reduce((a, v) => a + v.confidence, 0) / noVotes.length;
      return {
        direction: "NO",
        confidence: avgConf,
        note: `${noVotes.length}/3 momentum signals agree NO`,
      };
    }
    return { direction: "NEUTRAL", confidence: 0, note: "No confluence between indicators" };
  },
};
