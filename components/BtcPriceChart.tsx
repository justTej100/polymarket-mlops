"use client";

import { MarketSnapshot } from "@/lib/strategies/types";

const SVG_WIDTH = 800;
const SVG_HEIGHT = 280;
const PADDING = { top: 18, right: 74, bottom: 26, left: 14 };
const GRID_LINES = 4;

const UP_COLOR = "#22c55e";
const DOWN_COLOR = "#ef4444";

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

interface Point {
  x: number;
  y: number;
  price: number;
}

interface Segment {
  up: boolean; // at/above the price to beat
  points: Point[];
}

/**
 * Splits the price series into contiguous "up" (>= price to beat) and "down"
 * segments, interpolating the exact crossing point every time the line
 * crosses the strike -- so the color flips exactly at the dashed line, the
 * way Polymarket's own chart renders it.
 */
function buildSegments(points: Point[], baselineY: number): Segment[] {
  if (points.length === 0) return [];

  const segments: Segment[] = [];
  let current: Segment = { up: points[0].y <= baselineY, points: [points[0]] };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const nextUp = next.y <= baselineY;

    if (nextUp === current.up) {
      current.points.push(next);
      continue;
    }

    // Crossing: interpolate where the line meets the baseline.
    const dy = next.y - prev.y;
    const t = dy === 0 ? 0 : (baselineY - prev.y) / dy;
    const crossing: Point = {
      x: prev.x + (next.x - prev.x) * t,
      y: baselineY,
      price: prev.price + (next.price - prev.price) * t,
    };

    current.points.push(crossing);
    segments.push(current);
    current = { up: nextUp, points: [crossing, next] };
  }

  segments.push(current);
  return segments;
}

function linePath(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

function areaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

export function BtcPriceChart({ snapshots }: { snapshots: MarketSnapshot[] }) {
  if (snapshots.length === 0) {
    return <div className="price-chart price-chart--empty">Waiting for price feed...</div>;
  }

  const last = snapshots[snapshots.length - 1];
  const first = snapshots[0];
  const priceToBeat = last.priceToBeat;
  const aboveStrike = last.currentPrice >= priceToBeat;
  const liveColor = aboveStrike ? UP_COLOR : DOWN_COLOR;

  const prices = snapshots.map((s) => s.currentPrice);
  const minPrice = Math.min(...prices, priceToBeat);
  const maxPrice = Math.max(...prices, priceToBeat);
  const spread = maxPrice - minPrice || Math.max(maxPrice * 0.0005, 1);
  const paddedMin = minPrice - spread * 0.18;
  const paddedMax = maxPrice + spread * 0.18;

  const width = SVG_WIDTH - PADDING.left - PADDING.right;
  const height = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  const yFor = (price: number) =>
    PADDING.top + (1 - (price - paddedMin) / (paddedMax - paddedMin)) * height;

  const baselineY = yFor(priceToBeat);

  const points: Point[] = snapshots
    .map((s, i) => ({
      x:
        snapshots.length === 1
          ? PADDING.left + width / 2
          : PADDING.left + (i / (snapshots.length - 1)) * width,
      y: yFor(s.currentPrice),
      price: s.currentPrice,
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const segments = buildSegments(points, baselineY);
  const tip = points[points.length - 1];

  const gridPrices = Array.from({ length: GRID_LINES + 1 }, (_, i) => {
    const price = paddedMin + ((paddedMax - paddedMin) * i) / GRID_LINES;
    return { price, y: yFor(price) };
  });

  const changePct = ((last.currentPrice - priceToBeat) / priceToBeat) * 100;

  return (
    <div className="price-chart" aria-label="BTC price chart">
      <div className="price-chart__header">
        <div>
          <div className="price-chart__label">BTC / USD · Chainlink</div>
          <div className="price-chart__subline">
            {formatTime(first.timestamp)} – {formatTime(last.timestamp)}
          </div>
        </div>
        <div className="price-chart__readout">
          <div className="price-chart__value" style={{ color: liveColor }}>
            ${formatPrice(last.currentPrice)}
          </div>
          <div className="price-chart__delta" style={{ color: liveColor }}>
            {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(3)}% vs strike
          </div>
        </div>
      </div>

      <div className="price-chart__canvas">
        <svg className="price-chart__svg" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img">
          <defs>
            <linearGradient id="upArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={UP_COLOR} stopOpacity="0.28" />
              <stop offset="100%" stopColor={UP_COLOR} stopOpacity="0.03" />
            </linearGradient>
            <linearGradient id="downArea" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={DOWN_COLOR} stopOpacity="0.28" />
              <stop offset="100%" stopColor={DOWN_COLOR} stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {gridPrices.map((grid) => (
            <g key={grid.y}>
              <line
                x1={PADDING.left}
                x2={SVG_WIDTH - PADDING.right}
                y1={grid.y}
                y2={grid.y}
                className="price-chart__gridline"
              />
              <text
                x={SVG_WIDTH - PADDING.right + 8}
                y={grid.y + 4}
                className="price-chart__axis-label"
                textAnchor="start"
              >
                {formatPrice(grid.price)}
              </text>
            </g>
          ))}

          {/* shaded area between line and strike, per segment */}
          {segments.map((segment, i) => (
            <path
              key={`area-${i}`}
              d={areaPath(segment.points, baselineY)}
              fill={segment.up ? "url(#upArea)" : "url(#downArea)"}
            />
          ))}

          {/* the dashed price-to-beat reference line */}
          <line
            x1={PADDING.left}
            x2={SVG_WIDTH - PADDING.right}
            y1={baselineY}
            y2={baselineY}
            className="price-chart__baseline"
          />
          <g>
            <rect
              x={SVG_WIDTH - PADDING.right + 2}
              y={baselineY - 9}
              width={PADDING.right - 4}
              height={18}
              rx={4}
              className="price-chart__baseline-chip"
            />
            <text
              x={SVG_WIDTH - PADDING.right + 8}
              y={baselineY + 4}
              className="price-chart__baseline-label"
              textAnchor="start"
            >
              {formatPrice(priceToBeat)}
            </text>
          </g>

          {/* the price line, green above the strike / red below */}
          {segments.map((segment, i) => (
            <path
              key={`line-${i}`}
              d={linePath(segment.points)}
              className="price-chart__line"
              stroke={segment.up ? UP_COLOR : DOWN_COLOR}
              style={{
                filter: `drop-shadow(0 0 8px ${segment.up ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"})`,
              }}
            />
          ))}

          {/* live tip */}
          {tip && (
            <g>
              <circle cx={tip.x} cy={tip.y} r={9} fill={liveColor} opacity={0.18}>
                <animate attributeName="r" values="6;12;6" dur="1.8s" repeatCount="indefinite" />
                <animate
                  attributeName="opacity"
                  values="0.3;0.05;0.3"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx={tip.x} cy={tip.y} r={4} fill={liveColor} stroke="#0b0e13" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>

      <div className="price-chart__footer">
        <span>open ${formatPrice(first.currentPrice)}</span>
        <span className="price-chart__footer-strike">
          strike ${formatPrice(priceToBeat)}
          {last.priceToBeatPending ? " (provisional)" : ""}
        </span>
        <span style={{ color: liveColor }}>
          {aboveStrike ? "UP" : "DOWN"} {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(3)}%
        </span>
      </div>
    </div>
  );
}
