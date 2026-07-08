import { marketState } from "@/lib/worker/marketState";
import { strategies } from "@/lib/strategies";
import { startPolymarketStream } from "@/lib/polymarket/wsClient";

export const runtime = "nodejs"; // needs a long-lived connection, not edge
export const dynamic = "force-dynamic";

// Server-Sent Events endpoint. The dashboard subscribes to this once and gets
// pushed a fresh { snapshot, signals } payload every time the worker's
// in-memory marketState updates -- no client polling, no page refresh.
export async function GET() {
  const encoder = new TextEncoder();
  await startPolymarketStream();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = () => {
        if (closed) return;
        const snapshot = marketState.getLatest();
        if (!snapshot) return;
        const history = marketState.getHistory();

        const signals = strategies.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          signal: s.evaluate(snapshot, { snapshots: history }),
        }));

        const payload = JSON.stringify({ snapshot, history, signals });
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          closed = true;
          marketState.off("update", send);
        }
      };

      // Send immediately on connect, then on every subsequent tick.
      send();
      marketState.on("update", send);
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
