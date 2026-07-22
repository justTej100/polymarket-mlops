// Polymarket's Gamma API is used for market *discovery* -- finding the
// currently-active 5-minute BTC Up/Down market and its metadata (token ids,
// open/close times). The CLOB WebSocket (wsClient.ts) is used separately for
// live order book / price *streaming* once we know the token ids.
//
// 5-minute Up/Down market slugs are fully deterministic:
//   btc-updown-5m-{unixWindowStart}  where windowStart % 300 === 0
// so we never have to search -- we compute the slug from the clock.

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export const WINDOW_SECONDS = 5 * 60;
export const WINDOW_MS = WINDOW_SECONDS * 1000;

export interface ActiveMarketMeta {
  conditionId: string;
  slug: string;
  question: string;
  upTokenId: string;
  downTokenId: string;
  openTimeMs: number;
  closeTimeMs: number;
}

export interface ResolvedMarketMeta extends ActiveMarketMeta {
  closed: boolean;
  /** "YES" (Up) | "NO" (Down) | null if not resolved yet. */
  finalOutcome: "YES" | "NO" | null;
}

export function windowStartSec(nowMs = Date.now()): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_SECONDS;
}

export function slugForWindow(startSec: number): string {
  return `btc-updown-5m-${startSec}`;
}

interface GammaMarket {
  conditionId: string;
  slug: string;
  question?: string;
  outcomes?: string;        // JSON string, e.g. '["Up", "Down"]'
  clobTokenIds?: string;    // JSON string of two token ids
  outcomePrices?: string;   // JSON string, '["1", "0"]' once resolved
  closed?: boolean;
}

function parseMarket(market: GammaMarket, startSec: number): ResolvedMarketMeta {
  const outcomes: string[] = JSON.parse(market.outcomes ?? '["Up", "Down"]');
  const tokenIds: string[] = JSON.parse(market.clobTokenIds ?? "[]");
  if (tokenIds.length < 2) {
    throw new Error(`Market ${market.slug} is missing clobTokenIds`);
  }

  // Map outcome labels to token indices instead of assuming order.
  const upIndex = outcomes.findIndex((o) => /up|yes/i.test(o));
  const downIndex = upIndex === 0 ? 1 : 0;

  let finalOutcome: "YES" | "NO" | null = null;
  if (market.closed && market.outcomePrices) {
    const prices: number[] = JSON.parse(market.outcomePrices).map(Number);
    if (prices[upIndex] > 0.5) finalOutcome = "YES";
    else if (prices[downIndex] > 0.5) finalOutcome = "NO";
  }

  return {
    conditionId: market.conditionId,
    slug: market.slug,
    question: market.question ?? market.slug,
    upTokenId: tokenIds[upIndex === -1 ? 0 : upIndex],
    downTokenId: tokenIds[upIndex === -1 ? 1 : downIndex],
    openTimeMs: startSec * 1000,
    closeTimeMs: (startSec + WINDOW_SECONDS) * 1000,
    closed: Boolean(market.closed),
    finalOutcome,
  };
}

/**
 * Fetches one specific 5-min BTC window by its deterministic start timestamp.
 * Works for past (resolved) windows too via the /markets/slug endpoint,
 * which still serves markets that have dropped out of the list query.
 */
export async function fetchBtcMarketForWindow(startSec: number): Promise<ResolvedMarketMeta> {
  const slug = slugForWindow(startSec);
  const res = await fetch(`${GAMMA_BASE}/markets/slug/${slug}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Gamma API request for ${slug} failed: ${res.status}`);
  }
  const market = (await res.json()) as GammaMarket;
  if (!market?.conditionId) {
    throw new Error(`No BTC 5-min market found for ${slug}`);
  }
  return parseMarket(market, startSec);
}

/** Finds the currently active 5-minute BTC Up/Down market. */
export async function fetchActiveBtcMarket(): Promise<ActiveMarketMeta> {
  return fetchBtcMarketForWindow(windowStartSec());
}
