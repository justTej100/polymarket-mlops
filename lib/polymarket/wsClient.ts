import { ActiveMarketMeta, fetchBtcMarketForWindow, windowStartSec } from "./gammaClient";
import { marketState } from "../worker/marketState";
import { MarketSnapshot } from "../strategies/types";

// Force ws onto its pure-JS path inside the Next server bundle.
// The optional native buffer helper can explode under webpacked RSC code.
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require("ws") as typeof import("ws").default;

// Polymarket's real-time data socket streams the Chainlink BTC/USD price --
// the exact feed these markets resolve against (resolutionSource on every
// 5-min market). Subscribing also returns a per-second backfill, which is how
// we recover the "price to beat" (the Chainlink price at window open).
const RTDS_WS_URL = "wss://ws-live-data.polymarket.com";

// Polymarket CLOB websocket streams the live order book for the Up/Down
// tokens: `book` snapshots plus `price_change` events with best_bid/best_ask.
const CLOB_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const CLOB_REST_BASE = "https://clob.polymarket.com";

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const PRICE_BUFFER_LIMIT = 900; // ~15 min of 1Hz Chainlink ticks

interface PriceTick {
  timestampMs: number;
  value: number;
}

interface TokenQuote {
  bid: number | null;
  ask: number | null;
}

let started = false;
let startPromise: Promise<void> | null = null;

let currentMarket: ActiveMarketMeta | null = null;
let priceToBeat: number | null = null;
let priceToBeatPending = false;

const chainlinkTicks: PriceTick[] = [];
let latestChainlink: PriceTick | null = null;

const quotes = new Map<string, TokenQuote>(); // tokenId -> best bid/ask

let rtdsSocket: import("ws").default | null = null;
let clobSocket: import("ws").default | null = null;
let rtdsReconnectAttempts = 0;
let clobReconnectAttempts = 0;
let rolloverTimer: NodeJS.Timeout | null = null;

function log(scope: string, ...args: unknown[]) {
  console.log(`[${scope}]`, ...args);
}

// ---------------------------------------------------------------------------
// Chainlink price buffer + price-to-beat
// ---------------------------------------------------------------------------

function recordChainlinkTick(tick: PriceTick) {
  if (!Number.isFinite(tick.value) || tick.value <= 0) return;
  const last = chainlinkTicks[chainlinkTicks.length - 1];
  if (last && tick.timestampMs <= last.timestampMs) return; // keep sorted, dedupe
  chainlinkTicks.push(tick);
  if (chainlinkTicks.length > PRICE_BUFFER_LIMIT) {
    chainlinkTicks.splice(0, chainlinkTicks.length - PRICE_BUFFER_LIMIT);
  }
  if (!latestChainlink || tick.timestampMs >= latestChainlink.timestampMs) {
    latestChainlink = tick;
  }
}

/**
 * The strike is the first Chainlink print at/after window open (mirrors how
 * Polymarket resolves these markets). If our buffer doesn't reach back to the
 * boundary (e.g. server booted mid-window), we use the earliest tick we have
 * and flag the snapshot so the UI can show it as provisional.
 */
function resolvePriceToBeat() {
  if (!currentMarket || priceToBeat !== null && !priceToBeatPending) return;

  const openMs = currentMarket.openTimeMs;
  const firstAtOrAfterOpen = chainlinkTicks.find((t) => t.timestampMs >= openMs);

  if (firstAtOrAfterOpen && firstAtOrAfterOpen.timestampMs <= openMs + 5_000) {
    priceToBeat = firstAtOrAfterOpen.value;
    priceToBeatPending = false;
    return;
  }

  if (priceToBeat === null && firstAtOrAfterOpen) {
    // We have post-open ticks but missed the boundary itself -- best effort.
    priceToBeat = firstAtOrAfterOpen.value;
    priceToBeatPending = firstAtOrAfterOpen.timestampMs > openMs + 5_000;
  } else if (priceToBeat === null && latestChainlink) {
    priceToBeat = latestChainlink.value;
    priceToBeatPending = true;
  }
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

function midpoint(quote: TokenQuote | undefined): number | null {
  if (!quote) return null;
  if (quote.bid !== null && quote.ask !== null) return (quote.bid + quote.ask) / 2;
  return quote.bid ?? quote.ask;
}

function buildSnapshot(timestampMs: number): MarketSnapshot | null {
  if (!currentMarket || !latestChainlink || priceToBeat === null) return null;

  const upQuote = quotes.get(currentMarket.upTokenId);
  const downQuote = quotes.get(currentMarket.downTokenId);
  const upMid = midpoint(upQuote);
  const downMid = midpoint(downQuote);

  // Until the book arrives, fall back to complementary pricing so the
  // strategies always see a sane 0-1 pair.
  const yesPrice = upMid ?? (downMid !== null ? 1 - downMid : 0.5);
  const noPrice = downMid ?? 1 - yesPrice;

  return {
    conditionId: currentMarket.conditionId,
    asset: "BTC",
    priceToBeat,
    currentPrice: latestChainlink.value,
    yesPrice,
    noPrice,
    yesBidAskSpread:
      upQuote && upQuote.bid !== null && upQuote.ask !== null
        ? Math.max(0, upQuote.ask - upQuote.bid)
        : 0.01,
    secondsRemaining: Math.max(0, Math.round((currentMarket.closeTimeMs - timestampMs) / 1000)),
    timestamp: timestampMs,
    upBid: upQuote?.bid ?? undefined,
    upAsk: upQuote?.ask ?? undefined,
    downBid: downQuote?.bid ?? undefined,
    downAsk: downQuote?.ask ?? undefined,
    priceToBeatPending: priceToBeatPending || undefined,
    question: currentMarket.question,
  };
}

function emitSnapshot(timestampMs = Date.now()) {
  const snapshot = buildSnapshot(timestampMs);
  if (snapshot) marketState.update(snapshot);
}

// ---------------------------------------------------------------------------
// Window rollover
// ---------------------------------------------------------------------------

async function activateWindow(startSec: number, attempt = 0): Promise<void> {
  try {
    const market = await fetchBtcMarketForWindow(startSec);
    currentMarket = market;
    priceToBeat = null;
    priceToBeatPending = false;
    quotes.clear();
    marketState.reset();
    resolvePriceToBeat();
    log("market", `active window ${market.slug} (${market.question})`);

    await seedOrderBooks(market);
    resubscribeClob();
    emitSnapshot();
  } catch (err) {
    const delay = Math.min(1_000 * 2 ** attempt, 15_000);
    log("market", `failed to fetch window ${startSec}, retrying in ${delay}ms`, err);
    await new Promise((resolve) => setTimeout(resolve, delay));
    // The window may not be listed yet right at the boundary -- retry, but
    // recompute in case we crossed into the next window while waiting.
    return activateWindow(windowStartSec(), attempt + 1);
  }
}

function watchForRollover() {
  if (rolloverTimer) return;
  rolloverTimer = setInterval(() => {
    if (!currentMarket) return;
    if (Date.now() >= currentMarket.closeTimeMs) {
      const nextStart = windowStartSec();
      log("market", "window closed, rolling over to next 5-min market");
      void activateWindow(nextStart);
    }
  }, 1_000);
}

// ---------------------------------------------------------------------------
// CLOB order book (REST seed + WebSocket stream)
// ---------------------------------------------------------------------------

interface BookLevel {
  price: string;
  size: string;
}

function bestBid(bids: BookLevel[] | undefined): number | null {
  if (!bids?.length) return null;
  return bids.reduce((best, level) => Math.max(best, Number(level.price)), 0) || null;
}

function bestAsk(asks: BookLevel[] | undefined): number | null {
  if (!asks?.length) return null;
  const min = asks.reduce((best, level) => Math.min(best, Number(level.price)), Infinity);
  return Number.isFinite(min) ? min : null;
}

async function seedOrderBooks(market: ActiveMarketMeta) {
  await Promise.all(
    [market.upTokenId, market.downTokenId].map(async (tokenId) => {
      try {
        const res = await fetch(`${CLOB_REST_BASE}/book?token_id=${tokenId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const book = await res.json();
        quotes.set(tokenId, { bid: bestBid(book.bids), ask: bestAsk(book.asks) });
      } catch (err) {
        log("clob", `failed to seed book for token ${tokenId.slice(0, 8)}...`, err);
      }
    })
  );
}

function handleClobEvent(event: any) {
  if (!currentMarket) return;

  if (event.event_type === "book") {
    const tokenId = event.asset_id;
    if (tokenId !== currentMarket.upTokenId && tokenId !== currentMarket.downTokenId) return;
    quotes.set(tokenId, { bid: bestBid(event.bids), ask: bestAsk(event.asks) });
    emitSnapshot();
    return;
  }

  if (event.event_type === "price_change" && Array.isArray(event.price_changes)) {
    let changed = false;
    for (const change of event.price_changes) {
      const tokenId = change.asset_id;
      if (tokenId !== currentMarket.upTokenId && tokenId !== currentMarket.downTokenId) continue;
      const bid = Number.parseFloat(change.best_bid ?? "NaN");
      const ask = Number.parseFloat(change.best_ask ?? "NaN");
      const prev = quotes.get(tokenId) ?? { bid: null, ask: null };
      const next: TokenQuote = {
        bid: Number.isFinite(bid) ? bid : prev.bid,
        ask: Number.isFinite(ask) ? ask : prev.ask,
      };
      if (next.bid !== prev.bid || next.ask !== prev.ask) {
        quotes.set(tokenId, next);
        changed = true;
      }
    }
    if (changed) emitSnapshot();
  }
}

function resubscribeClob() {
  if (clobSocket) {
    clobSocket.removeAllListeners();
    try {
      clobSocket.close();
    } catch {
      /* already closed */
    }
    clobSocket = null;
  }
  connectClob();
}

function connectClob() {
  if (!currentMarket) return;
  const market = currentMarket;
  const ws = new WebSocket(CLOB_WS_URL);
  clobSocket = ws;

  ws.on("open", () => {
    clobReconnectAttempts = 0;
    ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: [market.upTokenId, market.downTokenId],
      })
    );
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const parsed = JSON.parse(raw.toString());
      const events = Array.isArray(parsed) ? parsed : [parsed];
      for (const event of events) handleClobEvent(event);
    } catch {
      // Non-JSON frames (e.g. "PONG") are expected -- ignore.
    }
  });

  ws.on("close", () => {
    if (clobSocket !== ws) return; // superseded by a rollover resubscribe
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** clobReconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    clobReconnectAttempts++;
    log("clob", `reconnecting in ${delay}ms (attempt ${clobReconnectAttempts})`);
    setTimeout(() => {
      if (clobSocket === ws) connectClob();
    }, delay);
  });

  ws.on("error", (err: unknown) => {
    log("clob", "websocket error", err);
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// RTDS Chainlink price stream
// ---------------------------------------------------------------------------

function handleRtdsMessage(msg: any) {
  if (msg?.topic && msg.topic !== "crypto_prices_chainlink") return;
  const payload = msg?.payload;
  if (!payload) return;

  // Subscribe responses carry a per-second backfill array; live updates carry
  // a single { timestamp, value } payload.
  if (Array.isArray(payload.data)) {
    for (const point of payload.data) {
      recordChainlinkTick({ timestampMs: Number(point.timestamp), value: Number(point.value) });
    }
    resolvePriceToBeat();
    emitSnapshot(latestChainlink?.timestampMs ?? Date.now());
    return;
  }

  if (payload.value !== undefined) {
    recordChainlinkTick({
      timestampMs: Number(payload.timestamp ?? Date.now()),
      value: Number(payload.value),
    });
    resolvePriceToBeat();
    emitSnapshot(Number(payload.timestamp ?? Date.now()));
  }
}

function connectRtds() {
  const ws = new WebSocket(RTDS_WS_URL);
  rtdsSocket = ws;

  ws.on("open", () => {
    rtdsReconnectAttempts = 0;
    ws.send(
      JSON.stringify({
        action: "subscribe",
        subscriptions: [
          {
            topic: "crypto_prices_chainlink",
            type: "*",
            filters: '{"symbol":"btc/usd"}',
          },
        ],
      })
    );
  });

  ws.on("message", (raw: Buffer) => {
    try {
      handleRtdsMessage(JSON.parse(raw.toString()));
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    if (rtdsSocket !== ws) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** rtdsReconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    rtdsReconnectAttempts++;
    log("rtds", `reconnecting in ${delay}ms (attempt ${rtdsReconnectAttempts})`);
    setTimeout(() => {
      if (rtdsSocket === ws) connectRtds();
    }, delay);
  });

  ws.on("error", (err: unknown) => {
    log("rtds", "websocket error", err);
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Starts the whole live pipeline (idempotent):
 *   Gamma discovery -> Chainlink RTDS stream -> CLOB book stream -> snapshots.
 */
export async function startPolymarketStream(): Promise<void> {
  if (started) {
    await startPromise;
    return;
  }
  started = true;

  startPromise = (async () => {
    connectRtds();
    await activateWindow(windowStartSec());
    watchForRollover();
  })().catch((err) => {
    console.error("[ws] failed to start live pipeline", err);
    started = false;
  });

  await startPromise;
}

/** @deprecated kept for backwards compatibility -- use startPolymarketStream. */
export const startBtcStream = startPolymarketStream;
