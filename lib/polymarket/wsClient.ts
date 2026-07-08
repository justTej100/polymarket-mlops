import WebSocket from "ws";
import { marketState } from "../worker/marketState";
import { fetchActiveBtcMarket, ActiveMarketMeta } from "./gammaClient";
import { MarketSnapshot } from "../strategies/types";

// Polymarket's CLOB market-data WebSocket. Streams live order book / price
// updates for a set of asset (token) ids. This connection must be long-lived,
// which is why the worker runs as an always-on Node process (Railway/Fly),
// not a serverless function.
const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const HEARTBEAT_INTERVAL_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let reconnectAttempts = 0;
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentMarket: ActiveMarketMeta | null = null;

function computeSnapshot(
  market: ActiveMarketMeta,
  yesPrice: number,
  noPrice: number,
  currentBtcPrice: number
): MarketSnapshot {
  const closeMs = new Date(market.closeTime).getTime();
  const secondsRemaining = Math.max(0, Math.round((closeMs - Date.now()) / 1000));

  return {
    conditionId: market.conditionId,
    asset: "BTC",
    priceToBeat: market.priceToBeat,
    currentPrice: currentBtcPrice,
    yesPrice,
    noPrice,
    yesBidAskSpread: 0, // filled in from order book depth if/when we parse it
    secondsRemaining,
    timestamp: Date.now(),
  };
}

export async function startPolymarketStream() {
  currentMarket = await fetchActiveBtcMarket();
  connect();
}

function connect() {
  if (!currentMarket) return;
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    reconnectAttempts = 0;
    ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: [currentMarket!.yesTokenId, currentMarket!.noTokenId],
      })
    );
    startHeartbeat(ws);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (err) {
      console.error("[ws] failed to parse message", err);
    }
  });

  ws.on("close", () => {
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[ws] error", err);
    ws.close();
  });
}

function startHeartbeat(ws: WebSocket) {
  heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function scheduleReconnect() {
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
    MAX_RECONNECT_DELAY_MS
  );
  reconnectAttempts++;
  console.warn(`[ws] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setTimeout(async () => {
    // Re-check the active market in case the 5-min window rolled over while
    // we were disconnected.
    try {
      currentMarket = await fetchActiveBtcMarket();
      marketState.reset(); // new window = fresh history
    } catch (err) {
      console.error("[ws] failed to refresh active market before reconnect", err);
    }
    connect();
  }, delay);
}

// NOTE: exact message shape should be confirmed against current Polymarket
// WS docs -- this handles the common "price_change" / "book" style payloads.
function handleMessage(msg: any) {
  if (!currentMarket) return;

  if (msg.event_type === "price_change" || msg.event_type === "book") {
    const yesPrice = parseFloat(msg.yes_price ?? msg.price ?? "0");
    const noPrice = 1 - yesPrice; // NO is complementary on a binary market
    const btcSpot = parseFloat(msg.underlying_price ?? "0");

    const snapshot = computeSnapshot(currentMarket, yesPrice, noPrice, btcSpot);
    marketState.update(snapshot);
  }

  // Detect window rollover: if the market has closed, refresh to the next one.
  if (msg.event_type === "market_resolved") {
    fetchActiveBtcMarket().then((next) => {
      currentMarket = next;
      marketState.reset();
    });
  }
}
