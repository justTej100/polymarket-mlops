import { Strategy } from "./types";
import { lotteryTicket } from "./lotteryTicket";
import { nearCertainSnipe } from "./nearCertainSnipe";
import { priceArbitrage } from "./priceArbitrage";
import { fibRetracement } from "./fibRetracement";
import { macdMomentum } from "./macdMomentum";
import { rsiMomentum } from "./rsiMomentum";
import { vwapMomentum } from "./vwapMomentum";
import { momentumStacking } from "./momentumStacking";
import { dumpHedgeArb } from "./dumpHedgeArb";

// Single source of truth: both the live worker and the backtest runner (and
// the frontend, for labels/descriptions) import from here. Add a strategy by
// writing a file that exports a Strategy and adding it to this array --
// nothing else needs to change.
export const strategies: Strategy[] = [
  lotteryTicket,
  nearCertainSnipe,
  priceArbitrage,
  fibRetracement,
  macdMomentum,
  rsiMomentum,
  vwapMomentum,
  momentumStacking,
  dumpHedgeArb,
];

export * from "./types";
