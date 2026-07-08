"use client";

import { MarketSnapshot } from "@/lib/strategies/types";

export function MarketEmbed({
  snapshot,
  connected,
  mode,
}: {
  snapshot: MarketSnapshot | null;
  connected: boolean;
  mode: "live" | "simulation";
}) {
  if (!snapshot) {
    return (
      <div className="market-embed market-embed--empty">
        <span className="status-dot status-dot--pending" />
        Waiting for {mode === "live" ? "live market data" : "simulation to start"}...
      </div>
    );
  }

  const minutes = Math.floor(snapshot.secondsRemaining / 60);
  const seconds = snapshot.secondsRemaining % 60;

  return (
    <div className="market-embed">
      <div className="market-embed__left">
        <span
          className={`status-dot ${
            mode === "live"
              ? connected
                ? "status-dot--live"
                : "status-dot--pending"
              : "status-dot--sim"
          }`}
        />
        <span className="market-embed__label">
          {mode === "live" ? "BTC 5-min Up/Down" : "Simulated BTC 5-min window"}
        </span>
      </div>
      <div className="market-embed__stats">
        <Stat label="Price to beat" value={`$${snapshot.priceToBeat.toLocaleString()}`} />
        <Stat label="Current price" value={`$${snapshot.currentPrice.toLocaleString()}`} />
        <Stat
          label="YES / NO"
          value={`${(snapshot.yesPrice * 100).toFixed(1)}c / ${(snapshot.noPrice * 100).toFixed(1)}c`}
        />
        <Stat
          label="Time left"
          value={`${minutes}:${seconds.toString().padStart(2, "0")}`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="market-embed__stat">
      <span className="market-embed__stat-label">{label}</span>
      <span className="market-embed__stat-value">{value}</span>
    </div>
  );
}
