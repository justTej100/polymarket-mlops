"use client";

import { BtcPriceChart } from "@/components/BtcPriceChart";
import { StrategySignalPayload } from "@/lib/hooks/useLiveStream";
import { MarketSnapshot } from "@/lib/strategies/types";

export function MarketEmbed({
  snapshot,
  history,
  signals,
  connected,
  mode,
}: {
  snapshot: MarketSnapshot | null;
  history: MarketSnapshot[];
  signals: StrategySignalPayload[];
  connected: boolean;
  mode: "live" | "simulation";
}) {
  const chartSnapshots = history.length > 0 ? history : snapshot ? [snapshot] : [];

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
      <div className="market-embed__top">
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
            {mode === "live" ? "BTC / USDT live window" : "Simulated BTC 5-min window"}
          </span>
        </div>
        <div className="market-embed__meta">
          <span className="market-embed__meta-item">Price to beat ${snapshot.priceToBeat.toLocaleString()}</span>
          <span className="market-embed__meta-item">Time left {minutes}:{seconds.toString().padStart(2, "0")}</span>
        </div>
      </div>

      <BtcPriceChart snapshots={chartSnapshots} signals={signals} />

      <div className="market-embed__stats">
        <Stat label="Current price" value={`$${snapshot.currentPrice.toLocaleString()}`} />
        <Stat label="YES / NO" value={`${(snapshot.yesPrice * 100).toFixed(1)}c / ${(snapshot.noPrice * 100).toFixed(1)}c`} />
        <Stat label="Window high" value={`$${Math.max(...chartSnapshots.map((s) => s.currentPrice)).toLocaleString()}`} />
        <Stat label="Window low" value={`$${Math.min(...chartSnapshots.map((s) => s.currentPrice)).toLocaleString()}`} />
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
