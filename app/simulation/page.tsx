"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarketEmbed } from "@/components/MarketEmbed";
import { StrategyBoard } from "@/components/StrategyBoard";
import { StrategyExplainer } from "@/components/StrategyExplainer";
import { strategies } from "@/lib/strategies";
import { MarketSnapshot } from "@/lib/strategies/types";

interface BacktestPayload {
  source: "historical" | "synthetic";
  snapshots: MarketSnapshot[];
  finalOutcome: "YES" | "NO";
}

const PLAYBACK_INTERVAL_MS = 150; // speed of tick-by-tick playback

export default function SimulationPage() {
  const [payload, setPayload] = useState<BacktestPayload | null>(null);
  const [tickIndex, setTickIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWindow = async () => {
    setPlaying(false);
    setTickIndex(0);
    const res = await fetch("/api/backtest");
    const data: BacktestPayload = await res.json();
    setPayload(data);
  };

  useEffect(() => {
    loadWindow();
  }, []);

  useEffect(() => {
    if (playing && payload) {
      timerRef.current = setInterval(() => {
        setTickIndex((i) => {
          if (i + 1 >= payload.snapshots.length) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, PLAYBACK_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, payload]);

  const currentSnapshot = payload?.snapshots[tickIndex] ?? null;

  const currentSignals = useMemo(() => {
    if (!payload || !currentSnapshot) return [];
    const history = { snapshots: payload.snapshots.slice(0, tickIndex + 1) };
    return strategies.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      signal: s.evaluate(currentSnapshot, history),
    }));
  }, [payload, currentSnapshot, tickIndex]);

  return (
    <>
      <p className="page-title">Simulation — Replaying a 5-min BTC Window</p>

      <div className="sim-controls">
        <button onClick={() => setPlaying((p) => !p)} disabled={!payload}>
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={loadWindow}>New window</button>
        <span className="sim-controls__label">
          {payload ? `tick ${tickIndex + 1} / ${payload.snapshots.length}` : "loading..."}
        </span>
        <input
          type="range"
          min={0}
          max={(payload?.snapshots.length ?? 1) - 1}
          value={tickIndex}
          onChange={(e) => {
            setPlaying(false);
            setTickIndex(Number(e.target.value));
          }}
        />
        {payload?.source === "synthetic" && (
          <span className="sim-controls__label" style={{ color: "var(--both)" }}>
            synthetic demo data
          </span>
        )}
      </div>

      <MarketEmbed
        snapshot={currentSnapshot}
        history={payload?.snapshots.slice(0, tickIndex + 1) ?? []}
        connected={true}
        mode="simulation"
      />
      <StrategyBoard signals={currentSignals} />
      <StrategyExplainer signals={currentSignals} />
    </>
  );
}
