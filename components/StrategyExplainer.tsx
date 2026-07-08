"use client";

import { StrategySignalPayload } from "@/lib/hooks/useLiveStream";

function displayDirection(direction: string): string {
  return direction === "NEUTRAL" ? "NO DECISION" : direction;
}

export function StrategyExplainer({ signals }: { signals: StrategySignalPayload[] }) {
  return (
    <div className="explainer">
      {signals.map((s) => (
        <div key={s.id} className={`explainer__row explainer__row--${s.signal.direction.toLowerCase()}`}>
          <div className="explainer__row-header">
            <span className="explainer__name">{s.name}</span>
            <span className={`explainer__badge explainer__badge--${s.signal.direction.toLowerCase()}`}>
              {displayDirection(s.signal.direction)}
            </span>
          </div>
          <p className="explainer__description">{s.description}</p>
          <p className="explainer__note">{s.signal.note}</p>
        </div>
      ))}
    </div>
  );
}
