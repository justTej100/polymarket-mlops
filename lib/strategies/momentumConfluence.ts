import { Strategy } from "./types";
import { clamp, ema, resampleBars, rsi } from "./helpers";

// Strategy 8 -- Binary Momentum (MACD / RSI / VWAP confluence).
// Three indicators on 5-second bars of the token price, combined into a
// confluence score. Replaces (and dedupes) the old separate MACD, RSI, VWAP
// and stacking strategies -- one strategy, one score.
//
// Score:  MACD trend state +2 · histogram building +1 · RSI 40-65 +1 ·
//         price on the right side of the session average +1 · minus 1 when
//         stretched >10c from that average.
// Enter at score >=4, hold while >=3, flat below that or on RSI extremes.
const BAR_SECONDS = 5;
const MACD_FAST = 3;
const MACD_SLOW = 8;
const MACD_SIGNAL = 3;
const RSI_PERIOD = 14;
const STRETCH_LIMIT = 0.1;
const ENTER_SCORE = 4;
const HOLD_SCORE = 3;

export const momentumConfluence: Strategy = {
  id: "momentum-confluence",
  name: "Momentum Confluence",
  description:
    "MACD (3/8/3), RSI (14) and a session-average anchor, all on 5-second bars of the token price, rolled into one confluence score. Enters only when 4+ points of signal agree, holds at 3, and flattens below that — or immediately on an RSI extreme (>75 / <25), which it treats as a take-profit bell. One strategy instead of four separate indicator bots.",
  evaluate: (snapshot, history) => {
    const bars = resampleBars(history, BAR_SECONDS, (s) => s.yesPrice);
    if (bars.length < MACD_SLOW + MACD_SIGNAL + 1) {
      return { direction: "NEUTRAL", confidence: 0, note: "Warming up (needs ~1 min of 5s bars)" };
    }

    const macdLine = ema(bars, MACD_FAST).map((v, i) => v - ema(bars, MACD_SLOW)[i]);
    const signalLine = ema(macdLine, MACD_SIGNAL);
    const hist = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];
    const prevHist = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];

    const rsiVal = rsi(bars, RSI_PERIOD);
    const anchor = bars.reduce((sum, v) => sum + v, 0) / bars.length; // TWAP stand-in for VWAP (token feed has no per-trade volume)
    const price = snapshot.yesPrice;
    const stretched = Math.abs(price - anchor) > STRETCH_LIMIT;

    let bullScore = 0;
    if (hist > 0) bullScore += 2; // MACD above its signal line
    if (hist > prevHist) bullScore += 1; // histogram building
    if (rsiVal !== null && rsiVal >= 40 && rsiVal <= 65) bullScore += 1;
    if (price > anchor) bullScore += 1;
    if (stretched) bullScore -= 1;

    let bearScore = 0;
    if (hist < 0) bearScore += 2;
    if (hist < prevHist) bearScore += 1;
    if (rsiVal !== null && rsiVal >= 35 && rsiVal <= 60) bearScore += 1;
    if (price < anchor) bearScore += 1;
    if (stretched) bearScore -= 1;

    // RSI extremes are exit bells regardless of score.
    if (rsiVal !== null && rsiVal >= 75 && bullScore >= bearScore) {
      return { direction: "NEUTRAL", confidence: 0, note: `RSI ${rsiVal.toFixed(0)} overbought — taking profit` };
    }
    if (rsiVal !== null && rsiVal <= 25 && bearScore >= bullScore) {
      return { direction: "NEUTRAL", confidence: 0, note: `RSI ${rsiVal.toFixed(0)} oversold — taking profit` };
    }

    if (bullScore >= ENTER_SCORE && bullScore > bearScore) {
      return { direction: "YES", confidence: clamp(bullScore / 5, 0.4, 1), note: `Bullish confluence ${bullScore}/5 (MACD+, RSI ${rsiVal?.toFixed(0) ?? "–"}, above anchor)` };
    }
    if (bearScore >= ENTER_SCORE && bearScore > bullScore) {
      return { direction: "NO", confidence: clamp(bearScore / 5, 0.4, 1), note: `Bearish confluence ${bearScore}/5 (MACD-, RSI ${rsiVal?.toFixed(0) ?? "–"}, below anchor)` };
    }
    if (bullScore >= HOLD_SCORE && bullScore > bearScore) {
      return { direction: "YES", confidence: 0.3, note: `Holding — bullish score ${bullScore}/5` };
    }
    if (bearScore >= HOLD_SCORE && bearScore > bullScore) {
      return { direction: "NO", confidence: 0.3, note: `Holding — bearish score ${bearScore}/5` };
    }

    return { direction: "NEUTRAL", confidence: 0, note: `Score too low (bull ${Math.max(bullScore, 0)}, bear ${Math.max(bearScore, 0)}) — need 4+ to enter` };
  },
};
