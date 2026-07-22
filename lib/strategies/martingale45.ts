import { Strategy } from "./types";
import { cents } from "./helpers";

// Strategy 6 -- Martingale / Anti-Martingale at 45c (auto mode).
// Mid-priced tokens (~45c) mean "50/50, we don't know" -- maximum reversion
// potential. The regime gate decides which book to run:
//   chop  -> martingale side: buy the dip side near 45c, sell the snap back to mid
//   trend -> anti-martingale: buy the trending side near 45-60c and ride it
// The spec's add-on ladders are approximated by re-entry after a flatten.
const REGIME_LOOKBACK_SECONDS = 120;
const CHOP_MAX_RANGE_PCT = 0.0015; // <=0.15% BTC range in 2 min = chop
const TREND_MIN_NET_PCT = 0.0012; // >=0.12% sustained net move = trend
const ENTRY_LOW = 0.3;
const ENTRY_HIGH = 0.48;
const TREND_ENTRY_HIGH = 0.6;

export const martingale45: Strategy = {
  id: "martingale-45",
  name: "Martingale @ 45¢",
  description:
    "Regime-gated mid-price trading. In confirmed chop (BTC range under 0.15% for 2 min) it buys the dipped side in the 30-48¢ zone and sells the reversion back above mid. In a confirmed trend it flips to anti-martingale: buy the trending side at 42-60¢ and ride it. Sits out when the regime is unclear — martingale into a trend is how binary accounts die.",
  evaluate: (snapshot, history) => {
    const last = snapshot.timestamp;
    const recent = history.snapshots.filter(
      (s) => s.timestamp >= last - REGIME_LOOKBACK_SECONDS * 1000
    );
    if (recent.length < 20 || last - recent[0].timestamp < 60_000) {
      return { direction: "NEUTRAL", confidence: 0, note: "Reading the regime (needs ~2 min of data)" };
    }

    const prices = recent.map((s) => s.currentPrice);
    const hi = Math.max(...prices);
    const lo = Math.min(...prices);
    const rangePct = (hi - lo) / snapshot.currentPrice;
    const netPct = (prices[prices.length - 1] - prices[0]) / prices[0];

    const trending = Math.abs(netPct) >= TREND_MIN_NET_PCT && Math.abs(netPct) >= rangePct * 0.6;
    const chopping = !trending && rangePct <= CHOP_MAX_RANGE_PCT;

    if (trending) {
      const direction = netPct > 0 ? "YES" : "NO";
      const price = direction === "YES" ? snapshot.yesPrice : snapshot.noPrice;
      if (price >= ENTRY_LOW && price <= TREND_ENTRY_HIGH) {
        return {
          direction,
          confidence: 0.5,
          note: `Anti-martingale: BTC trending ${netPct > 0 ? "up" : "down"} ${(netPct * 100).toFixed(2)}%, riding ${direction === "YES" ? "Up" : "Down"} at ${cents(price)}`,
        };
      }
      return { direction: "NEUTRAL", confidence: 0, note: "Trend confirmed but trend side outside entry zone" };
    }

    if (chopping) {
      const direction = snapshot.yesPrice <= snapshot.noPrice ? "YES" : "NO";
      const price = Math.min(snapshot.yesPrice, snapshot.noPrice);
      if (price >= ENTRY_LOW && price <= ENTRY_HIGH) {
        return {
          direction,
          confidence: 0.5,
          note: `Chop regime (range ${(rangePct * 100).toFixed(2)}%): buying dipped ${direction === "YES" ? "Up" : "Down"} at ${cents(price)}, target mid`,
        };
      }
      return { direction: "NEUTRAL", confidence: 0, note: "Chop regime but no side dipped into 30-48¢" };
    }

    return { direction: "NEUTRAL", confidence: 0, note: "Regime unclear — neither chop nor trend" };
  },
};
