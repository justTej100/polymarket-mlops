import { Strategy } from "./types";
import { cents, clamp, pctMoveOver } from "./helpers";

// Strategy 5 -- Cross-Market Bot (Lead-Lag).
// BTC and ETH are tightly correlated on short timeframes but reprice with a
// 5-30 second lag. We stream Chainlink ETH/USD alongside BTC: when ETH makes
// a sharp move and BTC hasn't followed yet -- and the BTC token in that
// direction hasn't repriced -- we buy the lagging BTC market ahead of the
// catch-up move.
const LOOKBACK_SECONDS = 30;
const MIN_LEAD_MOVE_PCT = 0.0025; // 0.25% ETH move in 30s
const FOLLOW_RATIO = 0.4; // if BTC already moved 40% as much, the edge is gone
const MAX_TOKEN_PRICE = 0.7; // skip if that side has already repriced

export const crossMarketLag: Strategy = {
  id: "cross-market-lag",
  name: "Cross-Market Lag (ETH leads)",
  description:
    "Watches Chainlink ETH/USD next to BTC. When ETH moves ≥0.25% in 30 seconds and BTC hasn't followed yet (nor has the token repriced past 70¢), it buys the BTC market in ETH's direction — correlated assets reprice with a 5-30s lag, and this front-runs the catch-up.",
  evaluate: (snapshot, history) => {
    if (snapshot.ethPrice === undefined) {
      return { direction: "NEUTRAL", confidence: 0, note: "No ETH feed on this data source" };
    }

    const ethMove = pctMoveOver(history, LOOKBACK_SECONDS, (s) => s.ethPrice);
    const btcMove = pctMoveOver(history, LOOKBACK_SECONDS, (s) => s.currentPrice);
    if (ethMove === null || btcMove === null) {
      return { direction: "NEUTRAL", confidence: 0, note: "Building 30s of dual-feed history" };
    }

    if (Math.abs(ethMove) < MIN_LEAD_MOVE_PCT) {
      return { direction: "NEUTRAL", confidence: 0, note: "No sharp ETH move to lead" };
    }

    const sameDirection = Math.sign(btcMove) === Math.sign(ethMove);
    if (sameDirection && Math.abs(btcMove) >= Math.abs(ethMove) * FOLLOW_RATIO) {
      return { direction: "NEUTRAL", confidence: 0, note: "BTC already followed ETH — edge gone" };
    }

    const direction = ethMove > 0 ? "YES" : "NO";
    const tokenPrice = direction === "YES" ? snapshot.yesPrice : snapshot.noPrice;
    if (tokenPrice > MAX_TOKEN_PRICE) {
      return { direction: "NEUTRAL", confidence: 0, note: `Token already repriced to ${cents(tokenPrice)}` };
    }

    return {
      direction,
      confidence: clamp(Math.abs(ethMove) / 0.005, 0.4, 0.9),
      note: `ETH ${ethMove > 0 ? "+" : ""}${(ethMove * 100).toFixed(2)}% in 30s, BTC lagging — buy ${direction === "YES" ? "Up" : "Down"} at ${cents(tokenPrice)}`,
    };
  },
};
