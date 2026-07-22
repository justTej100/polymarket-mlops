import { MarketSnapshot } from "../strategies/types";
import { fetchBtcMarketForWindow, windowStartSec, WINDOW_SECONDS } from "./gammaClient";

// Real historical data for the simulation page, stitched from:
//   - Gamma:   which resolved 5-min BTC window to replay + its final outcome
//   - CLOB:    prices-history for the Up token (minute-fidelity token prices)
//   - Binance: 1-second BTC/USDT klines for the underlying price path
//
// The BTC path comes from Binance klines rather than Chainlink (Chainlink has
// no public REST history), so the strike is approximated by the window's
// opening kline -- close enough for replaying strategy behavior.

const CLOB_REST_BASE = "https://clob.polymarket.com";
const BINANCE_REST_BASE = "https://api.binance.com";

export interface HistoricalWindow {
  conditionId: string;
  priceToBeat: number;
  finalOutcome: "YES" | "NO";
  snapshots: MarketSnapshot[];
}

interface PricePoint {
  t: number; // unix seconds
  p: number; // token price 0-1
}

async function fetchTokenPriceHistory(
  tokenId: string,
  startSec: number,
  endSec: number
): Promise<PricePoint[]> {
  const url = `${CLOB_REST_BASE}/prices-history?market=${tokenId}&startTs=${startSec}&endTs=${endSec}&fidelity=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`prices-history failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.history) ? data.history : [];
}

async function fetchBtcKlines(startSec: number, endSec: number): Promise<{ t: number; p: number }[]> {
  const url =
    `${BINANCE_REST_BASE}/api/v3/klines?symbol=BTCUSDT&interval=1s` +
    `&startTime=${startSec * 1000}&endTime=${endSec * 1000}&limit=${WINDOW_SECONDS}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance klines failed: ${res.status}`);
  const rows: unknown[][] = await res.json();
  return rows.map((row) => ({ t: Math.floor(Number(row[0]) / 1000), p: Number(row[4]) }));
}

/** Step-interpolated token price at a given second. */
function tokenPriceAt(history: PricePoint[], sec: number, fallback: number): number {
  let price = fallback;
  for (const point of history) {
    if (point.t > sec) break;
    price = point.p;
  }
  return price;
}

/**
 * Replays a real, already-resolved 5-minute BTC Up/Down window.
 * Picks a random recent window (within roughly the last hour) so the
 * simulation page's "New window" button gets variety, and retries a few
 * windows in case one is missing data.
 */
export async function fetchHistoricalWindow(): Promise<HistoricalWindow> {
  const current = windowStartSec();
  // Windows 2..12 back are old enough to be resolved but fresh enough that
  // Binance still serves 1s klines instantly.
  const candidates = shuffle(Array.from({ length: 11 }, (_, i) => current - (i + 2) * WINDOW_SECONDS));

  let lastError: unknown = null;
  for (const startSec of candidates.slice(0, 4)) {
    try {
      return await fetchWindow(startSec);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("no historical window available");
}

async function fetchWindow(startSec: number): Promise<HistoricalWindow> {
  const endSec = startSec + WINDOW_SECONDS;
  const market = await fetchBtcMarketForWindow(startSec);

  const [upHistory, klines] = await Promise.all([
    fetchTokenPriceHistory(market.upTokenId, startSec - 60, endSec),
    fetchBtcKlines(startSec, endSec),
  ]);

  if (klines.length < 30) {
    throw new Error(`not enough BTC klines for window ${startSec}`);
  }

  const priceToBeat = klines[0].p;
  const finalOutcome: "YES" | "NO" =
    market.finalOutcome ?? (klines[klines.length - 1].p >= priceToBeat ? "YES" : "NO");

  // One snapshot per 2 seconds keeps playback smooth without 300 ticks.
  const snapshots: MarketSnapshot[] = [];
  for (let i = 0; i < klines.length; i += 2) {
    const kline = klines[i];
    const upPrice = Math.min(0.99, Math.max(0.01, tokenPriceAt(upHistory, kline.t, 0.5)));
    snapshots.push({
      conditionId: market.conditionId,
      asset: "BTC",
      priceToBeat,
      currentPrice: kline.p,
      yesPrice: upPrice,
      noPrice: Math.round((1 - upPrice) * 1000) / 1000,
      yesBidAskSpread: 0.01,
      secondsRemaining: Math.max(0, endSec - kline.t),
      timestamp: kline.t * 1000,
      question: market.question,
    });
  }

  return {
    conditionId: market.conditionId,
    priceToBeat,
    finalOutcome,
    snapshots,
  };
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
