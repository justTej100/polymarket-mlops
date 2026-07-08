import { marketState } from "@/lib/worker/marketState";
import { strategies } from "@/lib/strategies";

export const runtime = "nodejs"; // needs a long-lived connection, not edge
export const dynamic = "force-dynamic";

// Server-Sent Events endpoint. The dashboard subscribes to this once and gets
// pushed a fresh { snapshot, signals } payload every time the worker's
// in-memory marketState updates -- no client polling, no page refresh.
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const snapshot = marketState.getLatest();
        if (!snapshot) return;
        const history = { snapshots: marketState.getHistory() };

        const signals = strategies.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          signal: s.evaluate(snapshot, history),
        }));

        const payload = JSON.stringify({ snapshot, signals });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      // Send immediately on connect, then on every subsequent tick.
      send();
      marketState.on("update", send);

      // Clean up if the client disconnects.
      return () => {
        marketState.off("update", send);
      };
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
