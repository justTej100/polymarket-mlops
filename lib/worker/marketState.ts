import { EventEmitter } from "events";
import { MarketSnapshot } from "../strategies/types";

// Lives entirely in the worker process's memory. Every WebSocket tick updates
// this, and the SSE route (app/api/stream) subscribes to "update" events to
// push the same data to the browser -- no polling, no DB round-trip on the
// hot path. Only strategy *signals* get written to the DB (see db.ts),
// not every raw tick.

const HISTORY_LIMIT = 360; // > one full 5-min window at ~1 snapshot/sec
const HISTORY_MIN_GAP_MS = 900; // history is ~1Hz even if ticks come faster

class MarketStateStore extends EventEmitter {
  private history: MarketSnapshot[] = [];
  private latest: MarketSnapshot | null = null;

  update(snapshot: MarketSnapshot) {
    this.latest = snapshot;

    // Keep `latest` real-time but sample history at ~1Hz so a burst of
    // order-book ticks can't evict the start of the window from the chart.
    const lastKept = this.history[this.history.length - 1];
    if (!lastKept || snapshot.timestamp - lastKept.timestamp >= HISTORY_MIN_GAP_MS) {
      this.history.push(snapshot);
      if (this.history.length > HISTORY_LIMIT) {
        this.history.shift();
      }
    } else {
      // Refresh the newest sample in place so quotes stay current.
      this.history[this.history.length - 1] = snapshot;
    }

    this.emit("update", snapshot);
  }

  getLatest(): MarketSnapshot | null {
    return this.latest;
  }

  getHistory(): MarketSnapshot[] {
    return this.history;
  }

  reset() {
    this.history = [];
    this.latest = null;
  }
}

// Singleton -- one shared instance across the whole process. Stored on
// globalThis because Next.js dev gives each route bundle its own module
// instances; without this, /api/stream and /api/copy would each get their
// own (conflicting) store.
const globalForMarketState = globalThis as unknown as { pmMarketState?: MarketStateStore };
export const marketState = globalForMarketState.pmMarketState ?? new MarketStateStore();
globalForMarketState.pmMarketState = marketState;
