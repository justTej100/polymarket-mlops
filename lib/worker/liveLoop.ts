import { startPolymarketStream } from "../polymarket/wsClient";
import { marketState } from "./marketState";
import { strategies } from "../strategies";
import { db } from "../db";

// This is the always-on process (run via `npm run worker`, deployed as a
// second process alongside the Next.js server on Railway/Fly). It:
//   1. Opens the Polymarket WebSocket and keeps marketState updated
//   2. Re-runs all 9 strategies on every tick
//   3. Persists a Signal row only when a strategy's direction *changes*
//      (not on every tick -- keeps the DB to meaningful events)

const lastDirectionByStrategy = new Map<string, string>();

async function ensureMarketRow(conditionId: string, priceToBeat: number) {
  return db.market.upsert({
    where: { conditionId },
    update: {},
    create: {
      conditionId,
      asset: "BTC",
      priceToBeat,
      openTime: new Date(),
      closeTime: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
}

async function onTick() {
  const snapshot = marketState.getLatest();
  if (!snapshot) return;
  const history = { snapshots: marketState.getHistory() };

  const market = await ensureMarketRow(snapshot.conditionId, snapshot.priceToBeat);

  for (const strategy of strategies) {
    const signal = strategy.evaluate(snapshot, history);
    const prevDirection = lastDirectionByStrategy.get(strategy.id);

    if (signal.direction !== "NEUTRAL" && signal.direction !== prevDirection) {
      lastDirectionByStrategy.set(strategy.id, signal.direction);
      await db.signal.create({
        data: {
          marketId: market.id,
          strategyId: strategy.id,
          direction: signal.direction,
          confidence: signal.confidence,
          entryPrice: signal.direction === "YES" ? snapshot.yesPrice : snapshot.noPrice,
        },
      });
      console.log(`[signal] ${strategy.id} -> ${signal.direction} (${signal.note})`);
    } else if (signal.direction === "NEUTRAL") {
      lastDirectionByStrategy.set(strategy.id, "NEUTRAL");
    }
  }
}

async function main() {
  console.log("[worker] starting Polymarket live loop...");
  marketState.on("update", () => {
    onTick().catch((err) => console.error("[worker] tick failed", err));
  });
  await startPolymarketStream();
}

main().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
