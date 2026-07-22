"use client";

import { BtcPriceChart } from "@/components/BtcPriceChart";
import { MarketSnapshot } from "@/lib/strategies/types";

function cents(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}¢`;
}

export function MarketEmbed({
  snapshot,
  history,
  connected,
  mode,
}: {
  snapshot: MarketSnapshot | null;
  history: MarketSnapshot[];
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

  // Buy at the ask, sell at the bid. In simulation (no order book) we fall
  // back to the midpoint for both sides.
  const upBuy = snapshot.upAsk ?? snapshot.yesPrice;
  const upSell = snapshot.upBid ?? snapshot.yesPrice;
  const downBuy = snapshot.downAsk ?? snapshot.noPrice;
  const downSell = snapshot.downBid ?? snapshot.noPrice;
  const upChance = snapshot.yesPrice;
  const downChance = snapshot.noPrice;

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
            {snapshot.question ??
              (mode === "live" ? "Bitcoin Up or Down — 5 min" : "Simulated BTC 5-min window")}
          </span>
        </div>
        <div className="market-embed__meta">
          <span className="market-embed__meta-item">
            Strike ${snapshot.priceToBeat.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {snapshot.priceToBeatPending ? "*" : ""}
          </span>
          <span
            className={`market-embed__meta-item ${
              snapshot.secondsRemaining <= 30 ? "market-embed__meta-item--urgent" : ""
            }`}
          >
            {minutes}:{seconds.toString().padStart(2, "0")} left
          </span>
        </div>
      </div>

      <div className="outcome-cards">
        <div className={`outcome-card outcome-card--up ${upChance >= downChance ? "outcome-card--leading" : ""}`}>
          <div className="outcome-card__head">
            <span className="outcome-card__name">▲ Up</span>
            <span className="outcome-card__chance">{(upChance * 100).toFixed(0)}%</span>
          </div>
          <div className="outcome-card__quotes">
            <div className="outcome-card__quote">
              <span className="outcome-card__quote-label">Buy</span>
              <span className="outcome-card__quote-value">{cents(upBuy)}</span>
            </div>
            <div className="outcome-card__quote">
              <span className="outcome-card__quote-label">Sell</span>
              <span className="outcome-card__quote-value">{cents(upSell)}</span>
            </div>
          </div>
        </div>

        <div className={`outcome-card outcome-card--down ${downChance > upChance ? "outcome-card--leading" : ""}`}>
          <div className="outcome-card__head">
            <span className="outcome-card__name">▼ Down</span>
            <span className="outcome-card__chance">{(downChance * 100).toFixed(0)}%</span>
          </div>
          <div className="outcome-card__quotes">
            <div className="outcome-card__quote">
              <span className="outcome-card__quote-label">Buy</span>
              <span className="outcome-card__quote-value">{cents(downBuy)}</span>
            </div>
            <div className="outcome-card__quote">
              <span className="outcome-card__quote-label">Sell</span>
              <span className="outcome-card__quote-value">{cents(downSell)}</span>
            </div>
          </div>
        </div>
      </div>

      <BtcPriceChart snapshots={chartSnapshots} />

      <div className="market-embed__stats">
        <Stat
          label="BTC price"
          value={`$${snapshot.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        />
        <Stat
          label="Price to beat"
          value={`$${snapshot.priceToBeat.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        />
        <Stat
          label="Window high"
          value={`$${Math.max(...chartSnapshots.map((s) => s.currentPrice)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        />
        <Stat
          label="Window low"
          value={`$${Math.min(...chartSnapshots.map((s) => s.currentPrice)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
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
