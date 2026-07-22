import { EventEmitter } from "events";
import { strategies } from "../strategies";
import { Direction, MarketSnapshot } from "../strategies/types";

// Paper-trading engine: every strategy gets an imaginary bankroll and trades
// it live. Entries fill at the real ask, exits at the real bid, and anything
// still held when the 5-minute window closes settles at $1 (win) or $0
// (loss). The engine keeps a full trade ledger plus per-window standings so
// the UI can show who made the most money, when they traded, and for how much.
//
// It also emits a "trade" event for every BUY/SELL, which the copy trader
// (lib/trading/copyTrader.ts) can mirror onto a real Polymarket account.

export const STARTING_BANKROLL = 1_000;
const MAX_STAKE_USD = 100;
const MIN_STAKE_USD = 5;
const LEDGER_LIMIT = 250;
const WINDOW_HISTORY_LIMIT = 24;
const EVAL_MIN_GAP_MS = 900;

export type TradeAction = "BUY" | "SELL" | "WIN" | "LOSS";
export type TradeSide = "UP" | "DOWN";

export interface PaperTrade {
  id: string;
  strategyId: string;
  strategyName: string;
  timestamp: number;
  action: TradeAction;
  side: TradeSide;
  price: number;      // per-share fill price (0-1)
  shares: number;
  amountUsd: number;  // cost for BUY, proceeds for SELL/WIN/LOSS
  note: string;
  conditionId: string;
}

interface OpenLot {
  side: TradeSide;
  shares: number;
  costUsd: number;
  entryPrice: number;
  openedAt: number;
}

interface StrategyBook {
  bankroll: number;
  lots: OpenLot[];
  lastDirection: Direction;
  windowPnl: number;
  totalPnl: number;
  wins: number;
  losses: number;
  trades: number;
}

export interface WindowResult {
  conditionId: string;
  question: string;
  closedAt: number;
  outcome: TradeSide;
  results: { strategyId: string; strategyName: string; pnlUsd: number }[];
  winnerId: string | null;
}

export interface PaperPublicState {
  startingBankroll: number;
  standings: {
    strategyId: string;
    strategyName: string;
    bankroll: number;
    equity: number; // bankroll + mark-to-market open positions
    windowPnl: number;
    totalPnl: number;
    wins: number;
    losses: number;
    trades: number;
    openPositions: {
      side: TradeSide;
      shares: number;
      entryPrice: number;
      markPrice: number;
      valueUsd: number;
    }[];
  }[];
  ledger: PaperTrade[];
  windows: WindowResult[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

class PaperTradingEngine extends EventEmitter {
  private books = new Map<string, StrategyBook>();
  private ledger: PaperTrade[] = [];
  private windows: WindowResult[] = [];
  private lastEvalTs = 0;
  private tradeSeq = 0;

  constructor() {
    super();
    this.setMaxListeners(30);
    for (const strategy of strategies) {
      this.books.set(strategy.id, {
        bankroll: STARTING_BANKROLL,
        lots: [],
        lastDirection: "NEUTRAL",
        windowPnl: 0,
        totalPnl: 0,
        wins: 0,
        losses: 0,
        trades: 0,
      });
    }
  }

  // -- fill prices -----------------------------------------------------------

  private askFor(side: TradeSide, snapshot: MarketSnapshot): number {
    const price =
      side === "UP" ? snapshot.upAsk ?? snapshot.yesPrice : snapshot.downAsk ?? snapshot.noPrice;
    return clamp(price, 0.01, 0.99);
  }

  private bidFor(side: TradeSide, snapshot: MarketSnapshot): number {
    const price =
      side === "UP" ? snapshot.upBid ?? snapshot.yesPrice : snapshot.downBid ?? snapshot.noPrice;
    return clamp(price, 0.01, 0.99);
  }

  // -- ledger ----------------------------------------------------------------

  private record(trade: Omit<PaperTrade, "id">): PaperTrade {
    const entry: PaperTrade = { ...trade, id: `${trade.timestamp}-${this.tradeSeq++}` };
    this.ledger.unshift(entry);
    if (this.ledger.length > LEDGER_LIMIT) this.ledger.pop();
    this.emit("trade", entry);
    return entry;
  }

  // -- trading ---------------------------------------------------------------

  private closeLots(
    strategyId: string,
    strategyName: string,
    book: StrategyBook,
    snapshot: MarketSnapshot,
    reason: string
  ) {
    for (const lot of book.lots) {
      const price = this.bidFor(lot.side, snapshot);
      const proceeds = round2(lot.shares * price);
      const pnl = round2(proceeds - lot.costUsd);
      book.bankroll = round2(book.bankroll + proceeds);
      book.windowPnl = round2(book.windowPnl + pnl);
      book.totalPnl = round2(book.totalPnl + pnl);

      this.record({
        strategyId,
        strategyName,
        timestamp: snapshot.timestamp,
        action: "SELL",
        side: lot.side,
        price,
        shares: lot.shares,
        amountUsd: proceeds,
        note: `${reason} · entered at ${(lot.entryPrice * 100).toFixed(1)}¢, ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        conditionId: snapshot.conditionId,
      });
    }
    book.lots = [];
  }

  private openLot(
    strategyId: string,
    strategyName: string,
    book: StrategyBook,
    snapshot: MarketSnapshot,
    side: TradeSide,
    stakeUsd: number,
    note: string
  ) {
    const price = this.askFor(side, snapshot);
    const cost = round2(Math.min(stakeUsd, book.bankroll));
    if (cost < MIN_STAKE_USD) return;

    const shares = round2(cost / price);
    book.bankroll = round2(book.bankroll - cost);
    book.trades += 1;
    book.lots.push({ side, shares, costUsd: cost, entryPrice: price, openedAt: snapshot.timestamp });

    this.record({
      strategyId,
      strategyName,
      timestamp: snapshot.timestamp,
      action: "BUY",
      side,
      price,
      shares,
      amountUsd: cost,
      note,
      conditionId: snapshot.conditionId,
    });
  }

  /** Runs every strategy against the latest snapshot and executes changes. */
  onSnapshot(snapshot: MarketSnapshot, history: MarketSnapshot[]) {
    if (snapshot.timestamp - this.lastEvalTs < EVAL_MIN_GAP_MS) return;
    this.lastEvalTs = snapshot.timestamp;

    for (const strategy of strategies) {
      const book = this.books.get(strategy.id)!;
      const signal = strategy.evaluate(snapshot, { snapshots: history });

      if (signal.direction === book.lastDirection) continue;

      // Direction changed: flatten the old position first.
      if (book.lots.length > 0) {
        this.closeLots(strategy.id, strategy.name, book, snapshot, "flipped signal");
      }

      const stake = round2(MAX_STAKE_USD * clamp(signal.confidence, 0.25, 1));

      if (signal.direction === "YES") {
        this.openLot(strategy.id, strategy.name, book, snapshot, "UP", stake, signal.note);
      } else if (signal.direction === "NO") {
        this.openLot(strategy.id, strategy.name, book, snapshot, "DOWN", stake, signal.note);
      } else if (signal.direction === "BOTH") {
        this.openLot(strategy.id, strategy.name, book, snapshot, "UP", stake / 2, signal.note);
        this.openLot(strategy.id, strategy.name, book, snapshot, "DOWN", stake / 2, signal.note);
      }

      book.lastDirection = signal.direction;
    }
  }

  /** Settles all open positions when a 5-minute window closes. */
  onWindowEnd(finalSnapshot: MarketSnapshot) {
    const outcome: TradeSide =
      finalSnapshot.currentPrice >= finalSnapshot.priceToBeat ? "UP" : "DOWN";

    const results: WindowResult["results"] = [];

    for (const strategy of strategies) {
      const book = this.books.get(strategy.id)!;

      const tradedThisWindow = book.lots.length > 0 || book.windowPnl !== 0;

      for (const lot of book.lots) {
        const won = lot.side === outcome;
        const payout = won ? round2(lot.shares) : 0; // $1 per winning share
        const pnl = round2(payout - lot.costUsd);
        book.bankroll = round2(book.bankroll + payout);
        book.windowPnl = round2(book.windowPnl + pnl);
        book.totalPnl = round2(book.totalPnl + pnl);

        this.record({
          strategyId: strategy.id,
          strategyName: strategy.name,
          timestamp: finalSnapshot.timestamp,
          action: won ? "WIN" : "LOSS",
          side: lot.side,
          price: won ? 1 : 0,
          shares: lot.shares,
          amountUsd: payout,
          note: `window resolved ${outcome} · ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
          conditionId: finalSnapshot.conditionId,
        });
      }

      // W/L = did the strategy end the window with more money than it
      // started with? Only windows where it actually traded count.
      if (tradedThisWindow) {
        if (book.windowPnl > 0) book.wins += 1;
        else if (book.windowPnl < 0) book.losses += 1;
      }

      book.lots = [];
      book.lastDirection = "NEUTRAL";
      results.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        pnlUsd: book.windowPnl,
      });
      book.windowPnl = 0;
    }

    const sorted = [...results].sort((a, b) => b.pnlUsd - a.pnlUsd);
    const winner = sorted[0];

    this.windows.unshift({
      conditionId: finalSnapshot.conditionId,
      question: finalSnapshot.question ?? finalSnapshot.conditionId,
      closedAt: finalSnapshot.timestamp,
      outcome,
      results: sorted,
      winnerId: winner && winner.pnlUsd !== 0 ? winner.strategyId : winner?.strategyId ?? null,
    });
    if (this.windows.length > WINDOW_HISTORY_LIMIT) this.windows.pop();
  }

  // -- public state for the UI -------------------------------------------------

  getPublicState(latestSnapshot: MarketSnapshot | null): PaperPublicState {
    const standings = strategies.map((strategy) => {
      const book = this.books.get(strategy.id)!;
      const openPositions = book.lots.map((lot) => {
        const markPrice = latestSnapshot ? this.bidFor(lot.side, latestSnapshot) : lot.entryPrice;
        return {
          side: lot.side,
          shares: lot.shares,
          entryPrice: lot.entryPrice,
          markPrice,
          valueUsd: round2(lot.shares * markPrice),
        };
      });
      const openValue = openPositions.reduce((sum, p) => sum + p.valueUsd, 0);

      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        bankroll: book.bankroll,
        equity: round2(book.bankroll + openValue),
        windowPnl: book.windowPnl,
        totalPnl: book.totalPnl,
        wins: book.wins,
        losses: book.losses,
        trades: book.trades,
        openPositions,
      };
    });

    // Rank by plain cash -- real dollars in hand, no mark-to-market guessing.
    standings.sort((a, b) => b.bankroll - a.bankroll);

    return {
      startingBankroll: STARTING_BANKROLL,
      standings,
      ledger: this.ledger.slice(0, 80),
      windows: this.windows.slice(0, 12),
    };
  }
}

// Process-wide singleton on globalThis: Next.js gives each route bundle its
// own module instances, and there must be exactly one book of record.
const globalForPaper = globalThis as unknown as { pmPaperEngine?: PaperTradingEngine };
export const paperEngine = globalForPaper.pmPaperEngine ?? new PaperTradingEngine();
globalForPaper.pmPaperEngine = paperEngine;
