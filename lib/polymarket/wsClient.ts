import { fetchActiveBtcMarket, ActiveMarketMeta } from "./gammaClient";
import { marketState } from "../worker/marketState";
import { MarketSnapshot } from "../strategies/types";

// Force ws onto its pure-JS path inside the Next server bundle.
// The optional native buffer helper can explode under webpacked RSC code.
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require("ws") as typeof import("ws").default;

// Binance public BTC/USDT trade stream gives spot price.
const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@trade";

// Polymarket CLOB websocket gives YES/NO token prices for the active market.
const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let binanceReconnectAttempts = 0;
let polymarketReconnectAttempts = 0;
let binanceReconnectTimer: NodeJS.Timeout | null = null;
let polymarketReconnectTimer: NodeJS.Timeout | null = null;
let binanceConnectionStarted = false;
let polymarketConnectionStarted = false;
let bootstrapPromise: Promise<void> | null = null;

let currentMarket: ActiveMarketMeta | null = null;
let latestSpotPrice: number | null = null;
let latestSpotQuantity: number | null = null;
let latestSpotTimestampMs: number | null = null;
let latestYesPrice: number | null = null;
let latestNoPrice: number | null = null;
let latestPolymarketTimestampMs: number | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function priceToProbability(currentPrice: number, priceToBeat: number) {
  const movePct = (currentPrice - priceToBeat) / priceToBeat;
  const yes = 1 / (1 + Math.exp(-movePct * 120));
  return clamp(yes, 0.02, 0.98);
}

function getCloseTimeMs(): number {
  return currentMarket ? new Date(currentMarket.closeTime).getTime() : Date.now() + 5 * 60 * 1000;
}

function maybeResetForNewMarket(timestampMs: number) {
  if (!currentMarket) return;
  const closeTimeMs = new Date(currentMarket.closeTime).getTime();
  if (timestampMs < closeTimeMs) return;

  currentMarket = null;
  latestSpotPrice = null;
  latestSpotQuantity = null;
  latestSpotTimestampMs = null;
  latestYesPrice = null;
  latestNoPrice = null;
  latestPolymarketTimestampMs = null;
  marketState.reset();
}

async function refreshActiveMarket() {
  const nextMarket = await fetchActiveBtcMarket();

  if (!currentMarket || currentMarket.conditionId !== nextMarket.conditionId) {
    currentMarket = nextMarket;
    latestSpotPrice = null;
    latestSpotQuantity = null;
    latestSpotTimestampMs = null;
    latestYesPrice = null;
    latestNoPrice = null;
    latestPolymarketTimestampMs = null;
    marketState.reset();
  } else {
    currentMarket = nextMarket;
  }
}

async function ensureActiveMarket() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if (marketState.getLatest() && currentMarket) return;
      await refreshActiveMarket();
    })().catch((err) => {
      console.error("[ws] failed to bootstrap active market", err);
    });
  }

  await bootstrapPromise;
}

function buildSnapshot(timestampMs: number): MarketSnapshot | null {
  if (!currentMarket) return null;

  const currentPrice = latestSpotPrice ?? currentMarket.priceToBeat;
  const yesPrice = latestYesPrice ?? priceToProbability(currentPrice, currentMarket.priceToBeat);
  const noPrice = latestNoPrice ?? 1 - yesPrice;

  return {
    conditionId: currentMarket.conditionId,
    asset: "BTC",
    priceToBeat: currentMarket.priceToBeat,
    currentPrice,
    yesPrice,
    noPrice,
    yesBidAskSpread:
      latestYesPrice != null && latestNoPrice != null ? Math.abs(latestYesPrice - latestNoPrice) : 0.0005,
    secondsRemaining: Math.max(0, Math.round((getCloseTimeMs() - timestampMs) / 1000)),
    timestamp: timestampMs,
    volume24h: latestSpotQuantity ?? undefined,
  };
}

function emitSnapshot(timestampMs: number) {
  const snapshot = buildSnapshot(timestampMs);
  if (!snapshot) return;
  marketState.update(snapshot);
}

export async function startBtcStream() {
  if (binanceConnectionStarted) return;
  binanceConnectionStarted = true;

  await ensureActiveMarket();
  connectBinance();
}

export async function startPolymarketStream() {
  if (polymarketConnectionStarted) return;
  polymarketConnectionStarted = true;

  await ensureActiveMarket();
  if (!binanceConnectionStarted) {
    await startBtcStream();
  }
  connectPolymarket();
}

function connectBinance() {
  const ws = new WebSocket(BINANCE_WS_URL);

  ws.on("open", () => {
    binanceReconnectAttempts = 0;
    if (binanceReconnectTimer) {
      clearTimeout(binanceReconnectTimer);
      binanceReconnectTimer = null;
    }
  });

  ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleBinanceMessage(msg);
    } catch (err) {
      console.error("[binance] failed to parse trade message", err);
    }
  });

  ws.on("close", () => {
    scheduleBinanceReconnect();
  });

  ws.on("error", (err: unknown) => {
    console.error("[binance] websocket error", err);
    ws.close();
  });
}

function connectPolymarket() {
  if (!currentMarket) return;

  const ws = new WebSocket(POLYMARKET_WS_URL);

  ws.on("open", () => {
    polymarketReconnectAttempts = 0;
    if (polymarketReconnectTimer) {
      clearTimeout(polymarketReconnectTimer);
      polymarketReconnectTimer = null;
    }

    ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: [currentMarket!.yesTokenId, currentMarket!.noTokenId],
      })
    );
  });

  ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const msg = JSON.parse(raw.toString());
      handlePolymarketMessage(msg);
    } catch (err) {
      console.error("[polymarket] failed to parse market message", err);
    }
  });

  ws.on("close", () => {
    schedulePolymarketReconnect();
  });

  ws.on("error", (err: unknown) => {
    console.error("[polymarket] websocket error", err);
    ws.close();
  });
}

function scheduleBinanceReconnect() {
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** binanceReconnectAttempts, MAX_RECONNECT_DELAY_MS);
  binanceReconnectAttempts++;
  console.warn(`[binance] reconnecting in ${delay}ms (attempt ${binanceReconnectAttempts})`);

  binanceReconnectTimer = setTimeout(() => {
    binanceReconnectTimer = null;
    connectBinance();
  }, delay);
}

function schedulePolymarketReconnect() {
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** polymarketReconnectAttempts, MAX_RECONNECT_DELAY_MS);
  polymarketReconnectAttempts++;
  console.warn(`[polymarket] reconnecting in ${delay}ms (attempt ${polymarketReconnectAttempts})`);

  polymarketReconnectTimer = setTimeout(async () => {
    polymarketReconnectTimer = null;
    try {
      await refreshActiveMarket();
    } catch (err) {
      console.error("[polymarket] failed to refresh active market before reconnect", err);
    }
    connectPolymarket();
  }, delay);
}

function handleBinanceMessage(msg: any) {
  const tradePrice = Number.parseFloat(msg.p ?? msg.price ?? "NaN");
  const tradeQuantity = Number.parseFloat(msg.q ?? msg.quantity ?? "1");
  const tradeTimeMs = Number(msg.T ?? msg.tradeTime ?? Date.now());

  if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
    return;
  }

  maybeResetForNewMarket(tradeTimeMs);
  latestSpotPrice = tradePrice;
  latestSpotQuantity = Number.isFinite(tradeQuantity) ? tradeQuantity : 1;
  latestSpotTimestampMs = tradeTimeMs;

  emitSnapshot(tradeTimeMs);
}

function handlePolymarketMessage(msg: any) {
  maybeResetForNewMarket(Number(msg.ts ?? msg.timestamp ?? Date.now()));

  if (msg.event_type !== "price_change" && msg.event_type !== "book") {
    return;
  }

  const yesPrice = Number.parseFloat(msg.yes_price ?? msg.price ?? msg.bid_price ?? "NaN");
  const noPrice = Number.parseFloat(msg.no_price ?? msg.ask_price ?? "NaN");
  const timestampMs = Number(msg.ts ?? msg.timestamp ?? msg.E ?? Date.now());

  if (Number.isFinite(yesPrice) && yesPrice > 0) {
    latestYesPrice = yesPrice;
  }

  if (Number.isFinite(noPrice) && noPrice > 0) {
    latestNoPrice = noPrice;
  }

  latestPolymarketTimestampMs = timestampMs;
  emitSnapshot(timestampMs);
}
