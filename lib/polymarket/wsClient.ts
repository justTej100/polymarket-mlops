import { ActiveMarketMeta, fetchBtcMarketForWindow, windowStartSec } from "./gammaClient";
import { marketState } from "../worker/marketState";
import { paperEngine } from "../worker/paperTrading";
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

interface PipelineState {
  started: boolean;
  startPromise: Promise<void> | null;
  currentMarket: ActiveMarketMeta | null;
  priceToBeat: number | null;
  priceToBeatPending: boolean;
  chainlinkTicks: PriceTick[];
  latestChainlink: PriceTick | null;
  latestEth: PriceTick | null;
  quotes: Map<string, TokenQuote>; // tokenId -> best bid/ask
  rtdsSocket: import("ws").default | null;
  ethSocket: import("ws").default | null;
  clobSocket: import("ws").default | null;
  rtdsReconnectAttempts: number;
  ethReconnectAttempts: number;
  clobReconnectAttempts: number;
  rolloverTimer: NodeJS.Timeout | null;
}

// The whole pipeline lives on globalThis: Next.js dev builds a separate
// module instance per route bundle, and without this both /api/stream and
// anything else importing this file would each start their own pipeline --
// duplicate sockets, duplicate paper trades, double window settlements.
const globalForPipeline = globalThis as unknown as { pmPipeline?: PipelineState };
const S: PipelineState = globalForPipeline.pmPipeline ?? {
  started: false,
  startPromise: null,
  currentMarket: null,
  priceToBeat: null,
  priceToBeatPending: false,
  chainlinkTicks: [],
  latestChainlink: null,
  latestEth: null,
  quotes: new Map(),
  rtdsSocket: null,
  ethSocket: null,
  clobSocket: null,
  rtdsReconnectAttempts: 0,
  ethReconnectAttempts: 0,
  clobReconnectAttempts: 0,
  rolloverTimer: null,
};
globalForPipeline.pmPipeline = S;

function log(scope: string, ...args: unknown[]) {
  console.log(`[${scope}]`, ...args);
}

// ---------------------------------------------------------------------------
// Chainlink price buffer + price-to-beat
// ---------------------------------------------------------------------------

function recordChainlinkTick(tick: PriceTick) {
  if (!Number.isFinite(tick.value) || tick.value <= 0) return;
  const last = S.chainlinkTicks[S.chainlinkTicks.length - 1];
  if (last && tick.timestampMs <= last.timestampMs) return; // keep sorted, dedupe
  S.chainlinkTicks.push(tick);
  if (S.chainlinkTicks.length > PRICE_BUFFER_LIMIT) {
    S.chainlinkTicks.splice(0, S.chainlinkTicks.length - PRICE_BUFFER_LIMIT);
  }
  if (!S.latestChainlink || tick.timestampMs >= S.latestChainlink.timestampMs) {
    S.latestChainlink = tick;
  }
}

/**
 * The strike is the first Chainlink print at/after window open (mirrors how
 * Polymarket resolves these markets). If our buffer doesn't reach back to the
 * boundary (e.g. server booted mid-window), we use the earliest tick we have
 * and flag the snapshot so the UI can show it as provisional.
 */
function resolvePriceToBeat() {
  if (!S.currentMarket || (S.priceToBeat !== null && !S.priceToBeatPending)) return;

  const openMs = S.currentMarket.openTimeMs;
  const firstAtOrAfterOpen = S.chainlinkTicks.find((t) => t.timestampMs >= openMs);

  if (firstAtOrAfterOpen && firstAtOrAfterOpen.timestampMs <= openMs + 5_000) {
    S.priceToBeat = firstAtOrAfterOpen.value;
    S.priceToBeatPending = false;
    return;
  }

  if (S.priceToBeat === null && firstAtOrAfterOpen) {
    // We have post-open ticks but missed the boundary itself -- best effort.
    S.priceToBeat = firstAtOrAfterOpen.value;
    S.priceToBeatPending = firstAtOrAfterOpen.timestampMs > openMs + 5_000;
  } else if (S.priceToBeat === null && S.latestChainlink) {
    S.priceToBeat = S.latestChainlink.value;
    S.priceToBeatPending = true;
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
  if (!S.currentMarket || !S.latestChainlink || S.priceToBeat === null) return null;

  const upQuote = S.quotes.get(S.currentMarket.upTokenId);
  const downQuote = S.quotes.get(S.currentMarket.downTokenId);
  const upMid = midpoint(upQuote);
  const downMid = midpoint(downQuote);

  // Until the book arrives, fall back to complementary pricing so the
  // strategies always see a sane 0-1 pair.
  const yesPrice = upMid ?? (downMid !== null ? 1 - downMid : 0.5);
  const noPrice = downMid ?? 1 - yesPrice;

  return {
    conditionId: S.currentMarket.conditionId,
    asset: "BTC",
    priceToBeat: S.priceToBeat,
    currentPrice: S.latestChainlink.value,
    yesPrice,
    noPrice,
    yesBidAskSpread:
      upQuote && upQuote.bid !== null && upQuote.ask !== null
        ? Math.max(0, upQuote.ask - upQuote.bid)
        : 0.01,
    secondsRemaining: Math.max(0, Math.round((S.currentMarket.closeTimeMs - timestampMs) / 1000)),
    timestamp: timestampMs,
    upBid: upQuote?.bid ?? undefined,
    upAsk: upQuote?.ask ?? undefined,
    downBid: downQuote?.bid ?? undefined,
    downAsk: downQuote?.ask ?? undefined,
    priceToBeatPending: S.priceToBeatPending || undefined,
    question: S.currentMarket.question,
    ethPrice: S.latestEth?.value,
  };
}

function emitSnapshot(timestampMs = Date.now()) {
  const snapshot = buildSnapshot(timestampMs);
  if (!snapshot) return;
  marketState.update(snapshot);
  paperEngine.onSnapshot(snapshot, marketState.getHistory());
}

/** The market currently being streamed (token ids etc.), if any. */
export function getCurrentMarket(): ActiveMarketMeta | null {
  return S.currentMarket;
}

// ---------------------------------------------------------------------------
// Window rollover
// ---------------------------------------------------------------------------

async function activateWindow(startSec: number, attempt = 0): Promise<void> {
  try {
    const market = await fetchBtcMarketForWindow(startSec);
    S.currentMarket = market;
    S.priceToBeat = null;
    S.priceToBeatPending = false;
    S.quotes.clear();
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
  if (S.rolloverTimer) return;
  let rollingOver = false;
  S.rolloverTimer = setInterval(() => {
    if (!S.currentMarket || rollingOver) return;
    if (Date.now() >= S.currentMarket.closeTimeMs) {
      rollingOver = true;
      const nextStart = windowStartSec();
      log("market", "window closed, rolling over to next 5-min market");

      // Settle every paper position at the final print before the reset.
      const finalSnapshot = marketState.getLatest();
      if (finalSnapshot) {
        paperEngine.onWindowEnd(finalSnapshot);
      }

      void activateWindow(nextStart).finally(() => {
        rollingOver = false;
      });
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
        S.quotes.set(tokenId, { bid: bestBid(book.bids), ask: bestAsk(book.asks) });
      } catch (err) {
        log("clob", `failed to seed book for token ${tokenId.slice(0, 8)}...`, err);
      }
    })
  );
}

function handleClobEvent(event: any) {
  if (!S.currentMarket) return;

  if (event.event_type === "book") {
    const tokenId = event.asset_id;
    if (tokenId !== S.currentMarket.upTokenId && tokenId !== S.currentMarket.downTokenId) return;
    S.quotes.set(tokenId, { bid: bestBid(event.bids), ask: bestAsk(event.asks) });
    emitSnapshot();
    return;
  }

  if (event.event_type === "price_change" && Array.isArray(event.price_changes)) {
    let changed = false;
    for (const change of event.price_changes) {
      const tokenId = change.asset_id;
      if (tokenId !== S.currentMarket.upTokenId && tokenId !== S.currentMarket.downTokenId) continue;
      const bid = Number.parseFloat(change.best_bid ?? "NaN");
      const ask = Number.parseFloat(change.best_ask ?? "NaN");
      const prev = S.quotes.get(tokenId) ?? { bid: null, ask: null };
      const next: TokenQuote = {
        bid: Number.isFinite(bid) ? bid : prev.bid,
        ask: Number.isFinite(ask) ? ask : prev.ask,
      };
      if (next.bid !== prev.bid || next.ask !== prev.ask) {
        S.quotes.set(tokenId, next);
        changed = true;
      }
    }
    if (changed) emitSnapshot();
  }
}

function resubscribeClob() {
  if (S.clobSocket) {
    S.clobSocket.removeAllListeners();
    try {
      S.clobSocket.close();
    } catch {
      /* already closed */
    }
    S.clobSocket = null;
  }
  connectClob();
}

function connectClob() {
  if (!S.currentMarket) return;
  const market = S.currentMarket;
  const ws = new WebSocket(CLOB_WS_URL);
  S.clobSocket = ws;

  ws.on("open", () => {
    S.clobReconnectAttempts = 0;
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
    if (S.clobSocket !== ws) return; // superseded by a rollover resubscribe
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** S.clobReconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    S.clobReconnectAttempts++;
    log("clob", `reconnecting in ${delay}ms (attempt ${S.clobReconnectAttempts})`);
    setTimeout(() => {
      if (S.clobSocket === ws) connectClob();
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
    emitSnapshot(S.latestChainlink?.timestampMs ?? Date.now());
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
  S.rtdsSocket = ws;

  ws.on("open", () => {
    S.rtdsReconnectAttempts = 0;
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
    if (S.rtdsSocket !== ws) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** S.rtdsReconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    S.rtdsReconnectAttempts++;
    log("rtds", `reconnecting in ${delay}ms (attempt ${S.rtdsReconnectAttempts})`);
    setTimeout(() => {
      if (S.rtdsSocket === ws) connectRtds();
    }, delay);
  });

  ws.on("error", (err: unknown) => {
    log("rtds", "websocket error", err);
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// RTDS Chainlink ETH/USD stream (separate socket so its backfill arrays can
// never be mistaken for BTC ticks). Only the latest value is kept -- the
// cross-market strategy reads its history back out of the snapshot buffer.
// ---------------------------------------------------------------------------

function handleEthMessage(msg: any) {
  if (msg?.topic && msg.topic !== "crypto_prices_chainlink") return;
  const payload = msg?.payload;
  if (!payload) return;

  if (Array.isArray(payload.data)) {
    const last = payload.data[payload.data.length - 1];
    if (last?.value !== undefined) {
      S.latestEth = { timestampMs: Number(last.timestamp), value: Number(last.value) };
    }
    return;
  }

  if (payload.value !== undefined) {
    S.latestEth = {
      timestampMs: Number(payload.timestamp ?? Date.now()),
      value: Number(payload.value),
    };
  }
}

function connectEth() {
  const ws = new WebSocket(RTDS_WS_URL);
  S.ethSocket = ws;

  ws.on("open", () => {
    S.ethReconnectAttempts = 0;
    ws.send(
      JSON.stringify({
        action: "subscribe",
        subscriptions: [
          {
            topic: "crypto_prices_chainlink",
            type: "*",
            filters: '{"symbol":"eth/usd"}',
          },
        ],
      })
    );
  });

  ws.on("message", (raw: Buffer) => {
    try {
      handleEthMessage(JSON.parse(raw.toString()));
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    if (S.ethSocket !== ws) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** S.ethReconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    S.ethReconnectAttempts++;
    log("rtds-eth", `reconnecting in ${delay}ms (attempt ${S.ethReconnectAttempts})`);
    setTimeout(() => {
      if (S.ethSocket === ws) connectEth();
    }, delay);
  });

  ws.on("error", (err: unknown) => {
    log("rtds-eth", "websocket error", err);
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Starts the whole live pipeline (idempotent, process-wide):
 *   Gamma discovery -> Chainlink RTDS stream -> CLOB book stream -> snapshots.
 */
export async function startPolymarketStream(): Promise<void> {
  if (S.started) {
    await S.startPromise;
    return;
  }
  S.started = true;

  S.startPromise = (async () => {
    connectRtds();
    connectEth();
    await activateWindow(windowStartSec());
    watchForRollover();
  })().catch((err) => {
    console.error("[ws] failed to start live pipeline", err);
    S.started = false;
  });

  await S.startPromise;
}

/** @deprecated kept for backwards compatibility -- use startPolymarketStream. */
export const startBtcStream = startPolymarketStream;
