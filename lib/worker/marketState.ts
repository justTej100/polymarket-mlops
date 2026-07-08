import { EventEmitter } from "events";
import { MarketSnapshot } from "../strategies/types";

// Lives entirely in the worker process's memory. Every WebSocket tick updates
// this, and the SSE route (app/api/stream) subscribes to "update" events to
// push the same data to the browser -- no polling, no DB round-trip on the
// hot path. Only strategy *signals* get written to Postgres (see db.ts),
// not every raw tick.

const HISTORY_LIMIT = 300; // ~ a few minutes of ticks at typical WS frequency

class MarketStateStore extends EventEmitter {
  private history: MarketSnapshot[] = [];
  private latest: MarketSnapshot | null = null;

  update(snapshot: MarketSnapshot) {
    this.latest = snapshot;
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
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

// Singleton -- one shared instance across the whole worker process.
export const marketState = new MarketStateStore();
