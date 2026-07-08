import WebSocket from "ws";
import { marketState } from "../worker/marketState";
import { MarketSnapshot } from "../strategies/types";

// Binance public BTC/USDT trade stream. This is the replacement live data
// source for the dashboard because it needs no signup and produces real-time
// BTC prints that can be turned into a 5-minute rolling window.
const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@trade";

const WINDOW_MS = 5 * 60 * 1000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let connectionStarted = false;
let bootstrapPromise: Promise<void> | null = null;

interface LiveWindow {
  windowStartMs: number;
  priceToBeat: number;
  conditionId: string;
}

let currentWindow: LiveWindow | null = null;

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

async function fetchBootstrapPrice() {
  const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Binance bootstrap request failed: ${res.status}`);
  }

  const data = await res.json();
  const price = Number.parseFloat(data?.price ?? "NaN");
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Binance bootstrap request returned an invalid price");
  }

  return price;
}

async function bootstrapWindowIfNeeded() {
  if (marketState.getLatest()) return;

  const currentPrice = await fetchBootstrapPrice();
  const now = Date.now();
  const windowStartMs = getWindowStart(now);
  currentWindow = {
    windowStartMs,
    priceToBeat: currentPrice,
    conditionId: `binance-btc-5m-${windowStartMs}`,
  };

  marketState.update(buildSnapshot(now, currentPrice, 0));
}

function buildSnapshot(tradeTimeMs: number, currentPrice: number, quantity: number): MarketSnapshot {
  const windowStartMs = getWindowStart(tradeTimeMs);
  const closeTimeMs = windowStartMs + WINDOW_MS;

  if (!currentWindow || currentWindow.windowStartMs !== windowStartMs) {
    currentWindow = {
      windowStartMs,
      priceToBeat: currentPrice,
      conditionId: `binance-btc-5m-${windowStartMs}`,
    };
    marketState.reset();
  }

  const yesPrice = priceToProbability(currentPrice, currentWindow.priceToBeat);
  const noPrice = 1 - yesPrice;

  return {
    conditionId: currentWindow.conditionId,
    asset: "BTC",
    priceToBeat: currentWindow.priceToBeat,
    currentPrice,
    yesPrice,
    noPrice,
    yesBidAskSpread: 0.0005,
    secondsRemaining: Math.max(0, Math.round((closeTimeMs - tradeTimeMs) / 1000)),
    timestamp: tradeTimeMs,
    volume24h: quantity,
  };
}

export async function startBtcStream() {
  if (connectionStarted) return;
  connectionStarted = true;

  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapWindowIfNeeded().catch((err) => {
      console.error("[binance] bootstrap failed", err);
    });
  }

  await bootstrapPromise;
  connect();
}

export async function startPolymarketStream() {
  return startBtcStream();
}

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (err) {
      console.error("[binance] failed to parse trade message", err);
    }
  });

  ws.on("close", () => {
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[binance] websocket error", err);
    ws.close();
  });
}

function scheduleReconnect() {
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;
  console.warn(`[binance] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function handleMessage(msg: any) {
  const tradePrice = Number.parseFloat(msg.p ?? msg.price ?? "NaN");
  const tradeQuantity = Number.parseFloat(msg.q ?? msg.quantity ?? "1");
  const tradeTimeMs = Number(msg.T ?? msg.tradeTime ?? Date.now());

  if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
    return;
  }

  const snapshot = buildSnapshot(tradeTimeMs, tradePrice, Number.isFinite(tradeQuantity) ? tradeQuantity : 1);
  marketState.update(snapshot);
}
