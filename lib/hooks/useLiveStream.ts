"use client";

import { useEffect, useRef, useState } from "react";
import { strategies } from "@/lib/strategies";
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

const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@miniTicker";
const WINDOW_MS = 5 * 60 * 1000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface LiveWindowState {
  windowStartMs: number;
  priceToBeat: number;
  conditionId: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWindowStart(timestampMs: number) {
  return Math.floor(timestampMs / WINDOW_MS) * WINDOW_MS;
}

function priceToProbability(currentPrice: number, priceToBeat: number) {
  const movePct = (currentPrice - priceToBeat) / priceToBeat;
  const yes = 1 / (1 + Math.exp(-movePct * 120));
  return clamp(yes, 0.02, 0.98);
}

function computeSnapshot(currentPrice: number, timestampMs: number, state: LiveWindowState): MarketSnapshot {
  const closeTimeMs = state.windowStartMs + WINDOW_MS;
  const yesPrice = priceToProbability(currentPrice, state.priceToBeat);

  return {
    conditionId: state.conditionId,
    asset: "BTC",
    priceToBeat: state.priceToBeat,
    currentPrice,
    yesPrice,
    noPrice: 1 - yesPrice,
    yesBidAskSpread: 0.0005,
    secondsRemaining: Math.max(0, Math.round((closeTimeMs - timestampMs) / 1000)),
    timestamp: timestampMs,
  };
}

/**
 * Subscribes to /api/stream (Server-Sent Events) and keeps the latest payload
 * in state. The connection auto-reconnects (native EventSource behavior) so
 * the dashboard never needs a manual page refresh.
 */
export function useLiveStream() {
  const [data, setData] = useState<StreamPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<MarketSnapshot[]>([]);
  const windowRef = useRef<LiveWindowState | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;

    const connect = () => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnected(true);
      };

      socket.onerror = () => {
        setConnected(false);
      };

      socket.onclose = () => {
        setConnected(false);
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttemptsRef.current,
          MAX_RECONNECT_DELAY_MS
        );
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const currentPrice = Number.parseFloat(msg.c ?? "NaN");
          const timestampMs = Number(msg.E ?? Date.now());

          if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
            return;
          }

          const windowStartMs = getWindowStart(timestampMs);
          if (!windowRef.current || windowRef.current.windowStartMs !== windowStartMs) {
            windowRef.current = {
              windowStartMs,
              priceToBeat: currentPrice,
              conditionId: `binance-btc-5m-${windowStartMs}`,
            };
            historyRef.current = [];
          }

          const snapshot = computeSnapshot(currentPrice, timestampMs, windowRef.current);
          const history = [...historyRef.current, snapshot].slice(-300);
          historyRef.current = history;

          const signals = strategies.map((strategy) => ({
            id: strategy.id,
            name: strategy.name,
            description: strategy.description,
            signal: strategy.evaluate(snapshot, { snapshots: history }),
          }));

          setData({ snapshot, history, signals });
        } catch {
          // ignore malformed payloads
        }
      };
    };

    connect();

    return () => {
      socket?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  return { data, connected };
}
