"use client";

import { useEffect, useState } from "react";
import { MarketSnapshot, Signal } from "@/lib/strategies/types";

export interface StrategySignalPayload {
  id: string;
  name: string;
  description: string;
  signal: Signal;
}

export interface StreamPayload {
  snapshot: MarketSnapshot;
  history: MarketSnapshot[];
  signals: StrategySignalPayload[];
}

/**
 * Subscribes to /api/stream (Server-Sent Events) and keeps the latest payload
 * in state. The connection auto-reconnects (native EventSource behavior) so
 * the dashboard never needs a manual page refresh.
 */
export function useLiveStream() {
  const [data, setData] = useState<StreamPayload | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data));
      } catch {
        // ignore malformed payloads
      }
    };

    return () => source.close();
  }, []);

  return { data, connected };
}
