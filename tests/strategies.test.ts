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

/** Builds a history of snapshots spaced `stepSeconds` apart, ending "now". */
function historySeries(
  count: number,
  stepSeconds: number,
  at: (index: number) => Partial<MarketSnapshot>
) {
  const endTs = 1_700_000_000_000 + count * stepSeconds * 1_000;
  return {
    snapshots: Array.from({ length: count }, (_, index) =>
      snapshot({
        timestamp: endTs - (count - 1 - index) * stepSeconds * 1_000,
        secondsRemaining: Math.max(0, 300 - index),
        ...at(index),
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

test("strategy registry is the canonical strategy set", () => {
  assert.deepEqual(
    strategies.map((strategy) => strategy.id),
    [
      "lottery-5c",
      "lottery-30c",
      "lottery-40c",
      "sniper-99c",
      "dual-reversion",
      "pre-order-open",
      "cross-market-lag",
      "martingale-45",
      "fibonacci",
      "momentum-confluence",
      "dump-hedge",
    ]
  );

  for (const strategy of strategies) {
    assert.equal(typeof strategy.name, "string");
    assert.equal(typeof strategy.description, "string");
    assertValidSignal(strategy.evaluate(snapshot(), { snapshots: [snapshot()] }));
  }
});

test("all strategies fire under representative conditions", () => {
  const byId = new Map(strategies.map((strategy) => [strategy.id, strategy]));

  // 1 -- an underdog below each variant's threshold is a buy; above it, not.
  assert.equal(
    byId.get("lottery-5c")!.evaluate(
      snapshot({ yesPrice: 0.04, noPrice: 0.96, secondsRemaining: 90 }),
      { snapshots: [] }
    ).direction,
    "YES"
  );
  assert.equal(
    byId.get("lottery-5c")!.evaluate(
      snapshot({ yesPrice: 0.28, noPrice: 0.72, secondsRemaining: 90 }),
      { snapshots: [] }
    ).direction,
    "NEUTRAL"
  );
  assert.equal(
    byId.get("lottery-30c")!.evaluate(
      snapshot({ yesPrice: 0.28, noPrice: 0.72, secondsRemaining: 90 }),
      { snapshots: [] }
    ).direction,
    "YES"
  );
  assert.equal(
    byId.get("lottery-40c")!.evaluate(
      snapshot({ yesPrice: 0.62, noPrice: 0.38, secondsRemaining: 90 }),
      { snapshots: [] }
    ).direction,
    "NO"
  );

  // 2 -- final minute, spot clearly past strike, winner still asks <=99c.
  assert.equal(
    byId.get("sniper-99c")!.evaluate(
      snapshot({ yesPrice: 0.97, noPrice: 0.03, secondsRemaining: 40, currentPrice: 100.3 }),
      { snapshots: [] }
    ).direction,
    "YES"
  );

  // 3 -- both sides compressed into 30-48c with 2+ minutes left.
  assert.equal(
    byId.get("dual-reversion")!.evaluate(
      snapshot({ yesPrice: 0.44, noPrice: 0.45, secondsRemaining: 150 }),
      { snapshots: [] }
    ).direction,
    "BOTH"
  );

  // 4 -- fresh window, both sides discounted before midpoint discovery.
  assert.equal(
    byId.get("pre-order-open")!.evaluate(
      snapshot({ yesPrice: 0.45, noPrice: 0.45, secondsRemaining: 280 }),
      { snapshots: [] }
    ).direction,
    "BOTH"
  );

  // 5 -- ETH rips 0.4% in 30s while BTC and the token haven't moved yet.
  const lagHistory = historySeries(40, 1, (i) => ({
    currentPrice: 100,
    ethPrice: i < 10 ? 3000 : 3000 + ((i - 9) / 30) * 12,
  }));
  assert.equal(
    byId.get("cross-market-lag")!.evaluate(lagHistory.snapshots.at(-1)!, lagHistory).direction,
    "YES"
  );

  // 6 -- dead-flat BTC (chop regime) with one side dipped to 45c.
  const chopHistory = historySeries(130, 1, () => ({
    currentPrice: 100,
    yesPrice: 0.45,
    noPrice: 0.55,
  }));
  assert.equal(
    byId.get("martingale-45")!.evaluate(chopHistory.snapshots.at(-1)!, chopHistory).direction,
    "YES"
  );

  // 7 -- Up token swung 42c -> 58c in the first 90s, now dipped to 50c
  // (inside the fib retracement zone) with 150s left.
  const fibHistory = historySeries(150, 1, (i) => ({
    yesPrice: i < 40 ? 0.42 + (i / 39) * 0.16 : 0.5,
    noPrice: i < 40 ? 0.58 - (i / 39) * 0.16 : 0.5,
    secondsRemaining: 300 - (i + 1), // window opened 150s before the last snapshot
  }));
  assert.equal(
    byId.get("fibonacci")!.evaluate(fibHistory.snapshots.at(-1)!, fibHistory).direction,
    "YES"
  );

  // 8 -- token grinding up on 5s bars with mild pullbacks (MACD bullish,
  // RSI neutral, price above the session anchor).
  const confluenceHistory = historySeries(30, 5, (i) => {
    const price = 0.45 + 0.0015 * i + (i % 2 ? 0.008 : 0); // up-grind with alternating pullbacks
    return { yesPrice: price, noPrice: 1 - price };
  });
  assert.equal(
    byId
      .get("momentum-confluence")!
      .evaluate(confluenceHistory.snapshots.at(-1)!, confluenceHistory).direction,
    "YES"
  );

  // 9 -- BTC dumps 0.4% in seconds, Up collapses to 10c while Down asks 85c:
  // buy the pair for 95c combined (locked edge).
  const dumpHistory = historySeries(30, 1, (i) => ({
    currentPrice: i < 25 ? 100 : 100 - (i - 24) * 0.08,
    yesPrice: 0.1,
    noPrice: 0.85,
  }));
  assert.equal(
    byId.get("dump-hedge")!.evaluate(dumpHistory.snapshots.at(-1)!, dumpHistory).direction,
    "BOTH"
  );
});

test("backtest runner evaluates every strategy and counts BOTH as a win", () => {
  const snapshots = [
    snapshot({ yesPrice: 0.44, noPrice: 0.45, secondsRemaining: 150, timestamp: 1 }),
    snapshot({ yesPrice: 0.44, noPrice: 0.45, secondsRemaining: 149, timestamp: 2 }),
  ];

  const results = runBacktestOnWindow(snapshots, "YES");
  assert.equal(results.length, strategies.length);

  const arb = results.find((result) => result.strategyId === "dual-reversion");
  assert.ok(arb);
  assert.equal(arb.trades, 1);
  assert.equal(arb.wins, 1);
  assert.equal(arb.winRate, 1);

  const summary = runBacktestOnManyWindows([{ snapshots, finalOutcome: "YES" }]);
  assert.equal(summary["dual-reversion"].trades, 1);
  assert.equal(summary["dual-reversion"].wins, 1);
});

test("backtest API returns a runnable window and per-strategy results", async () => {
  const response = await getBacktest();
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.ok(["historical", "synthetic"].includes(body.source));
  assert.equal(body.results.length, strategies.length);
  assert.ok(body.snapshots.length > 0);
  assert.equal(typeof body.conditionId, "string");
});

test("stream API emits snapshot and every strategy's signal", async () => {
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
  assert.equal(payload.signals.length, strategies.length);
  assert.equal(payload.snapshot.conditionId, "test-window");
});
