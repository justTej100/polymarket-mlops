import { Strategy } from "./types";
import { lottery5c, lottery30c, lottery40c } from "./cheapDislocation";
import { sniper99 } from "./sniper99";
import { dualReversion } from "./dualReversion";
import { preOrderOpen } from "./preOrderOpen";
import { crossMarketLag } from "./crossMarketLag";
import { martingale45 } from "./martingale45";
import { fibonacci } from "./fibonacci";
import { momentumConfluence } from "./momentumConfluence";
import { dumpHedge } from "./dumpHedge";

// Single source of truth: both the live worker and the backtest runner (and
// the frontend, for labels/descriptions) import from here. Add a strategy by
// writing a file that exports a Strategy and adding it to this array --
// nothing else needs to change.
//
// The strategies mirror the strategy spec 1:1 (the old separate MACD, RSI,
// VWAP and stacking bots were merged into momentum-confluence so there are
// no duplicates). Strategy 1 runs in three flavors with different entry
// thresholds so the leaderboard shows which "cheap" actually pays.
export const strategies: Strategy[] = [
  lottery5c, // 1a -- lottery ticket, side under 5c
  lottery30c, // 1b -- underdog under 30c
  lottery40c, // 1c -- underdog under 40c
  sniper99, // 2 -- 99c Sniper (Near-Resolution Strike)
  dualReversion, // 3 -- Low-Side Dual Reversion
  preOrderOpen, // 4 -- Pre-Order Market (Queue Positioning)
  crossMarketLag, // 5 -- Cross-Market Bot (Lead-Lag)
  martingale45, // 6 -- Martingale / Anti-Martingale at 45c
  fibonacci, // 7 -- Fibonacci Levels
  momentumConfluence, // 8 -- Binary Momentum (MACD / RSI / VWAP)
  dumpHedge, // 9 -- Dump-Hedge (Sharp Move Arbitrage)
];

export * from "./types";
