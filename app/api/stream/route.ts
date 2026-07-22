import { marketState } from "@/lib/worker/marketState";
import { strategies } from "@/lib/strategies";
import { startPolymarketStream } from "@/lib/polymarket/wsClient";

export const runtime = "nodejs"; // needs a long-lived connection, not edge
export const dynamic = "force-dynamic";

const PUSH_INTERVAL_MS = 500; // at most ~2 pushes/sec per subscriber

// Server-Sent Events endpoint. The dashboard subscribes to this once and gets
// pushed a fresh payload every time the worker's in-memory marketState
// updates -- no client polling, no page refresh.
//
// Strategy evaluation happens once per broadcast and is shared across every
// subscriber; the full history array is only sent on the first message of a
// connection, after which clients receive just the latest snapshot (deltas).

const subscribers = new Set<(tick: string) => void>();
let broadcastTimer: NodeJS.Timeout | null = null;
let listenerAttached = false;
let pendingBroadcast = false;

function evaluatePayload(includeHistory: boolean): string | null {
  const snapshot = marketState.getLatest();
  if (!snapshot) return null;
  const history = marketState.getHistory();

  const signals = strategies.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    signal: s.evaluate(snapshot, { snapshots: history }),
  }));

  return JSON.stringify(includeHistory ? { snapshot, history, signals } : { snapshot, signals });
}

function broadcast() {
  if (subscribers.size === 0) return;
  const payload = evaluatePayload(false);
  if (!payload) return;
  for (const send of subscribers) send(payload);
}

function scheduleBroadcast() {
  if (broadcastTimer) {
    pendingBroadcast = true;
    return;
  }
  broadcast();
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (pendingBroadcast) {
      pendingBroadcast = false;
      scheduleBroadcast();
    }
  }, PUSH_INTERVAL_MS);
}

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  marketState.on("update", scheduleBroadcast);
}

export async function GET() {
  const encoder = new TextEncoder();
  if (!marketState.getLatest()) {
    await startPolymarketStream();
  }
  ensureListener();

  let subscriber: ((tick: string) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      subscriber = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          if (subscriber) subscribers.delete(subscriber);
        }
      };

      // First message carries the full history so the chart can render the
      // whole window immediately; subsequent messages are snapshot deltas.
      const initial = evaluatePayload(true);
      if (initial) {
        controller.enqueue(encoder.encode(`data: ${initial}\n\n`));
      }
      subscribers.add(subscriber);
    },
    cancel() {
      if (subscriber) subscribers.delete(subscriber);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
