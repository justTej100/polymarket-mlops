"use client";

import { StrategySignalPayload } from "@/lib/hooks/useLiveStream";

const BOARD_HEIGHT = 340;
const BASELINE_Y = BOARD_HEIGHT / 2;
const ZONE_PADDING = 28; // keep boxes off the very top/bottom edge

// Confidence pushes a box further from the baseline, toward the strong edge
// of its zone. NEUTRAL strategies sit right on the baseline (no conviction).
function verticalOffset(direction: string, confidence: number): number {
  const maxTravel = BASELINE_Y - ZONE_PADDING;
  const travel = confidence * maxTravel;
  if (direction === "YES") return -travel; // move up into the green zone
  if (direction === "NO") return travel; // move down into the red zone
  return 0; // NEUTRAL or BOTH sit on the baseline
}

function displayDirection(direction: string): string {
  return direction === "NEUTRAL" ? "NO DECISION" : direction;
}

export function StrategyBoard({ signals }: { signals: StrategySignalPayload[] }) {
  return (
    <div className="board">
      <div className="board__zone board__zone--yes">
        <span className="board__zone-label">UP / YES</span>
      </div>
      <div className="board__zone board__zone--no">
        <span className="board__zone-label">DOWN / NO</span>
      </div>
      <div className="board__baseline" />

      <div className="board__boxes" style={{ height: BOARD_HEIGHT }}>
        {signals.map((s, i) => {
          const { direction, confidence } = s.signal;
          const offset = verticalOffset(direction, confidence);
          const leftPercent = ((i + 0.5) / signals.length) * 100;

          return (
            <div
              key={s.id}
              className={`board__box board__box--${direction.toLowerCase()}`}
              style={{
                left: `${leftPercent}%`,
                top: `${BASELINE_Y + offset}px`,
              }}
              title={s.signal.note}
            >
              <span className="board__box-name">{s.name}</span>
              <span className="board__box-dir">{displayDirection(direction)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
