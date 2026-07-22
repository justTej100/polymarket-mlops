"use client";

import { useEffect, useRef, useState } from "react";
import { MarketSnapshot, Signal } from "@/lib/strategies/types";
import type { PaperPublicState } from "@/lib/worker/paperTrading";
import type { CopyStatus } from "@/lib/trading/copyTrader";

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
  paper: PaperPublicState | null;
  copy: CopyStatus | null;
}

interface ServerMessage {
  snapshot: MarketSnapshot;
  history?: MarketSnapshot[];
  signals: StrategySignalPayload[];
  paper?: PaperPublicState;
  copy?: CopyStatus;
}

const HISTORY_LIMIT = 400;
const HISTORY_MIN_GAP_MS = 900;

/**
 * Subscribes to /api/stream (Server-Sent Events), where the server relays
 * real Polymarket data: the Chainlink BTC/USD price feed and the live CLOB
 * order book for the current 5-minute Up/Down market. The first message
 * carries the full window history; later messages are snapshot deltas that we
 * fold into a local history buffer. EventSource reconnects automatically, and
 * every reconnect re-delivers the full history.
 */
export function useLiveStream() {
  const [data, setData] = useState<StreamPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<MarketSnapshot[]>([]);
  const conditionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        const { snapshot } = msg;

        if (msg.history) {
          historyRef.current = msg.history;
        } else {
          if (conditionIdRef.current !== snapshot.conditionId) {
            // New 5-min window started -- the old chart no longer applies.
            historyRef.current = [];
          }
          const history = historyRef.current;
          const last = history[history.length - 1];
          if (!last || snapshot.timestamp - last.timestamp >= HISTORY_MIN_GAP_MS) {
            history.push(snapshot);
            if (history.length > HISTORY_LIMIT) history.shift();
          } else {
            history[history.length - 1] = snapshot;
          }
        }

        conditionIdRef.current = snapshot.conditionId;
        setData({
          snapshot,
          history: [...historyRef.current],
          signals: msg.signals,
          paper: msg.paper ?? null,
          copy: msg.copy ?? null,
        });
        setConnected(true);
      } catch {
        // ignore malformed payloads
      }
    };

    return () => {
      source.close();
    };
  }, []);

  return { data, connected };
}
