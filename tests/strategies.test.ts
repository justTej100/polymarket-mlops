import assert from "node:assert/strict";
import test from "node:test";
import { strategies, type Direction, type MarketSnapshot } from "../lib/strategies";
import { runBacktestOnManyWindows, runBacktestOnWindow } from "../lib/worker/backtestRunner";
import { marketState } from "../lib/worker/marketState";
import { GET as getBacktest } from "../app/api/backtest/route";
import { GET as getStream } from "../app/api/stream/route";

const validDirections: Direction[] = ["YES", "NO", "BOTH", "NEUTRAL"];

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    conditionId: "test-window",
    asset: "BTC",
    priceToBeat: 100,
    currentPrice: 100,
    yesPrice: 0.5,
    noPrice: 0.5,
    yesBidAskSpread: 0.01,
    secondsRemaining: 120,
    timestamp: Date.now(),
    volume24h: 500_000,
    ...overrides,
  };
}

function historyFromPrices(prices: number[], overrides: Partial<MarketSnapshot> = {}) {
  return {
    snapshots: prices.map((price, index) =>
      snapshot({
        currentPrice: price,
        timestamp: 1_700_000_000_000 + index * 1_000,
        secondsRemaining: Math.max(0, 300 - index),
        ...overrides,
      })
    ),
  };
}

function assertValidSignal(signal: ReturnType<(typeof strategies)[number]["evaluate"]>) {
  assert.ok(validDirections.includes(signal.direction));
  assert.ok(signal.confidence >= 0 && signal.confidence <= 1);
  assert.equal(typeof signal.note, "string");
  assert.ok(signal.note.length > 0);
}

test("strategy registry is the canonical nine-strategy set", () => {
  assert.deepEqual(
    strategies.map((strategy) => strategy.id),
    [
      "lottery-ticket",
      "near-certain-snipe",
      "price-arbitrage",
      "fib-retracement",
      "macd-momentum",
      "rsi-momentum",
      "vwap-momentum",
      "momentum-stacking",
      "dump-hedge-arb",
    ]
  );

  for (const strategy of strategies) {
    assert.equal(typeof strategy.name, "string");
    assert.equal(typeof strategy.description, "string");
    assertValidSignal(strategy.evaluate(snapshot(), { snapshots: [snapshot()] }));
  }
});

test("all nine strategies fire under representative conditions", () => {
  const byId = new Map(strategies.map((strategy) => [strategy.id, strategy]));

  assert.equal(
    byId.get("lottery-ticket")!.evaluate(
      snapshot({ yesPrice: 0.04, noPrice: 0.96, secondsRemaining: 90 }),
      { snapshots: [] }
    ).direction,
    "YES"
  );

  assert.equal(
    byId.get("near-certain-snipe")!.evaluate(
      snapshot({ yesPrice: 0.98, noPrice: 0.02, secondsRemaining: 10 }),
      { snapshots: [] }
    ).direction,
    "YES"
  );

  assert.equal(
    byId.get("price-arbitrage")!.evaluate(snapshot({ yesPrice: 0.47, noPrice: 0.48 }), {
      snapshots: [],
    }).direction,
    "BOTH"
  );

  const fibHistory = historyFromPrices([100, 110, 116.18, 120, 107.64]);
  assert.equal(
    byId.get("fib-retracement")!.evaluate(fibHistory.snapshots.at(-1)!, fibHistory).direction,
    "YES"
  );

  const macdHistory = historyFromPrices([
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
    100, 100, 100, 100, 100, 100, 100, 106,
  ]);
  assert.equal(
    byId.get("macd-momentum")!.evaluate(macdHistory.snapshots.at(-1)!, macdHistory).direction,
    "YES"
  );

  const rsiHistory = historyFromPrices([110, 109, 108, 107, 106, 105, 104, 103]);
  assert.equal(
    byId.get("rsi-momentum")!.evaluate(rsiHistory.snapshots.at(-1)!, rsiHistory).direction,
    "YES"
  );

  const vwapHistory = historyFromPrices([100, 100, 100, 100, 101]);
  assert.equal(
    byId.get("vwap-momentum")!.evaluate(vwapHistory.snapshots.at(-1)!, vwapHistory).direction,
    "YES"
  );

  assert.equal(
    byId.get("momentum-stacking")!.evaluate(macdHistory.snapshots.at(-1)!, macdHistory).direction,
    "YES"
  );

  const dumpHistory = historyFromPrices([100, 100, 100, 100, 99.7]);
  assert.equal(
    byId.get("dump-hedge-arb")!.evaluate(dumpHistory.snapshots.at(-1)!, dumpHistory).direction,
    "YES"
  );
});

test("backtest runner evaluates every strategy and counts BOTH as a win", () => {
  const snapshots = [
    snapshot({ yesPrice: 0.47, noPrice: 0.48, timestamp: 1 }),
    snapshot({ yesPrice: 0.47, noPrice: 0.48, timestamp: 2 }),
  ];

  const results = runBacktestOnWindow(snapshots, "YES");
  assert.equal(results.length, 9);

  const arb = results.find((result) => result.strategyId === "price-arbitrage");
  assert.ok(arb);
  assert.equal(arb.trades, 1);
  assert.equal(arb.wins, 1);
  assert.equal(arb.winRate, 1);

  const summary = runBacktestOnManyWindows([{ snapshots, finalOutcome: "YES" }]);
  assert.equal(summary["price-arbitrage"].trades, 1);
  assert.equal(summary["price-arbitrage"].wins, 1);
});

test("backtest API returns a runnable window and per-strategy results", async () => {
  const response = await getBacktest();
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.ok(["historical", "synthetic"].includes(body.source));
  assert.equal(body.results.length, 9);
  assert.ok(body.snapshots.length > 0);
  assert.equal(typeof body.conditionId, "string");
});

test("stream API emits snapshot and nine strategy signals", async () => {
  marketState.reset();
  marketState.update(snapshot({ yesPrice: 0.47, noPrice: 0.48 }));

  const response = await getStream();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");

  const reader = response.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();

  const chunk = new TextDecoder().decode(value);
  assert.ok(chunk.startsWith("data: "));
  const payload = JSON.parse(chunk.replace(/^data: /, "").trim());
  assert.equal(payload.signals.length, 9);
  assert.equal(payload.snapshot.conditionId, "test-window");
});
