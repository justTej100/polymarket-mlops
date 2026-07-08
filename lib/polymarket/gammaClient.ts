// Polymarket's Gamma API is used for market *discovery* -- finding the
// currently-active 5-minute BTC Up/Down market and its metadata (token ids,
// price-to-beat, open/close times). The CLOB WebSocket (wsClient.ts) is used
// separately for live order book / price *streaming* once we know the token ids.
//
// Docs: https://docs.polymarket.com/

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export interface ActiveMarketMeta {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  priceToBeat: number;
  openTime: string;
  closeTime: string;
}

/**
 * Finds the currently active 5-minute BTC Up/Down market.
 * NOTE: the exact Gamma query params/slug pattern for the 5-min BTC series
 * should be confirmed against current docs/dashboard network tab -- Polymarket
 * has changed market slugs before. This is written to be easy to swap out.
 */
export async function fetchActiveBtcMarket(): Promise<ActiveMarketMeta> {
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&series=bitcoin-up-or-down-5min`
  );
  if (!res.ok) {
    throw new Error(`Gamma API request failed: ${res.status}`);
  }
  const data = await res.json();

  // Gamma returns an array of markets; take the soonest-closing active one.
  const market = Array.isArray(data) ? data[0] : data?.markets?.[0];
  if (!market) {
    throw new Error("No active BTC 5-min market found");
  }

  const tokenIds: string[] = JSON.parse(market.clobTokenIds ?? "[]");

  return {
    conditionId: market.conditionId,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    priceToBeat: parseFloat(market.priceToBeat ?? market?.strikePrice ?? "0"),
    openTime: market.startDate ?? market.eventStartTime,
    closeTime: market.endDate ?? market.eventEndTime,
  };
}
