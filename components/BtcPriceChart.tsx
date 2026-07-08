"use client";

import { StrategySignalPayload } from "@/lib/hooks/useLiveStream";
import { MarketSnapshot } from "@/lib/strategies/types";

const SVG_WIDTH = 800;
const SVG_HEIGHT = 260;
const PADDING = { top: 16, right: 18, bottom: 34, left: 52 };
const GRID_LINES = 4;

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function BtcPriceChart({
  snapshots,
  signals = [],
}: {
  snapshots: MarketSnapshot[];
  signals?: StrategySignalPayload[];
}) {
  if (snapshots.length === 0) {
    return <div className="price-chart price-chart--empty">Waiting for BTC ticks...</div>;
  }

  const prices = snapshots.map((snapshot) => snapshot.currentPrice);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const spread = maxPrice - minPrice || Math.max(maxPrice * 0.002, 1);
  const paddedMin = minPrice - spread * 0.12;
  const paddedMax = maxPrice + spread * 0.12;
  const width = SVG_WIDTH - PADDING.left - PADDING.right;
  const height = SVG_HEIGHT - PADDING.top - PADDING.bottom;
  const lastSnapshot = snapshots[snapshots.length - 1];
  const firstSnapshot = snapshots[0];
  const baselineY =
    PADDING.top + (1 - (lastSnapshot.priceToBeat - paddedMin) / (paddedMax - paddedMin)) * height;

  const points = snapshots
    .map((snapshot, index) => {
      const x =
        snapshots.length === 1
          ? PADDING.left + width / 2
          : PADDING.left + (index / (snapshots.length - 1)) * width;
      const y =
        PADDING.top +
        (1 - (snapshot.currentPrice - paddedMin) / (paddedMax - paddedMin)) * height;
      return { x, y, price: snapshot.currentPrice, timestamp: snapshot.timestamp };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${SVG_HEIGHT - PADDING.bottom} L ${points[0].x.toFixed(2)} ${SVG_HEIGHT - PADDING.bottom} Z`
      : "";

  const gridPrices = Array.from({ length: GRID_LINES + 1 }, (_, index) => {
    const price = paddedMin + ((paddedMax - paddedMin) * index) / GRID_LINES;
    const y = PADDING.top + ((GRID_LINES - index) / GRID_LINES) * height;
    return { price, y };
  });

  return (
    <div className="price-chart" aria-label="BTC price history chart">
      <div className="price-chart__header">
        <div>
          <div className="price-chart__label">BTC / USDT</div>
          <div className="price-chart__subline">
            {formatTime(firstSnapshot.timestamp)} - {formatTime(lastSnapshot.timestamp)}
          </div>
        </div>
        <div className="price-chart__value">${formatPrice(lastSnapshot.currentPrice)}</div>
      </div>

      <div className="price-chart__canvas">
        <div className="price-chart__overlay" aria-hidden="true">
          {signals.map((signal, index) => {
            const leftPercent = ((index + 0.5) / Math.max(signals.length, 1)) * 100;
            const direction = signal.signal.direction;
            return (
              <div
                key={signal.id}
                className={`price-chart__signal price-chart__signal--${direction.toLowerCase()}`}
                style={{ left: `${leftPercent}%` }}
                title={signal.signal.note}
              >
                <span className="price-chart__signal-name">{signal.name}</span>
                <span className="price-chart__signal-dir">{direction}</span>
              </div>
            );
          })}
        </div>

        <svg className="price-chart__svg" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img">
          <defs>
            <linearGradient id="priceLineGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--amber)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <line
            x1={PADDING.left}
            x2={SVG_WIDTH - PADDING.right}
            y1={baselineY}
            y2={baselineY}
            className="price-chart__baseline"
          />
          <text x={SVG_WIDTH - PADDING.right} y={baselineY - 6} className="price-chart__baseline-label" textAnchor="end">
            price to beat
          </text>

          {gridPrices.map((grid) => (
            <g key={grid.y}>
              <line
                x1={PADDING.left}
                x2={SVG_WIDTH - PADDING.right}
                y1={grid.y}
                y2={grid.y}
                className="price-chart__gridline"
              />
              <text x={PADDING.left - 10} y={grid.y + 4} className="price-chart__axis-label" textAnchor="end">
                {formatPrice(grid.price)}
              </text>
            </g>
          ))}

          <path d={areaPath} className="price-chart__area" />
          <path d={linePath} className="price-chart__line" />

          {points.map((point, index) => (
            <circle
              key={`${point.timestamp}-${index}`}
              cx={point.x}
              cy={point.y}
              r={index === points.length - 1 ? 4.5 : 2.5}
              className={index === points.length - 1 ? "price-chart__dot price-chart__dot--active" : "price-chart__dot"}
            />
          ))}
        </svg>
      </div>

      <div className="price-chart__footer">
        <span>{formatPrice(firstSnapshot.currentPrice)}</span>
        <span>{formatPrice(lastSnapshot.currentPrice)}</span>
        <span>{((lastSnapshot.currentPrice - firstSnapshot.currentPrice) / firstSnapshot.currentPrice * 100).toFixed(2)}%</span>
      </div>
    </div>
  );
}
