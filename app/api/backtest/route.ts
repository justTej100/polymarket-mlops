import { NextResponse } from "next/server";
import { fetchHistoricalWindow } from "@/lib/polymarket/historicalClient";
import { generateSyntheticWindow } from "@/lib/polymarket/syntheticWindow";
import { runBacktestOnWindow } from "@/lib/worker/backtestRunner";

export async function GET() {
  let window;
  let source: "historical" | "synthetic" = "historical";

  try {
    window = await fetchHistoricalWindow();
  } catch {
    // Real historical endpoint isn't wired up yet (see historicalClient.ts) --
    // fall back to a clearly-labeled synthetic window so the simulation page
    // still works end-to-end during local development.
    window = generateSyntheticWindow();
    source = "synthetic";
  }

  const results = runBacktestOnWindow(window.snapshots, window.finalOutcome);

  return NextResponse.json({
    source,
    conditionId: window.conditionId,
    priceToBeat: window.priceToBeat,
    finalOutcome: window.finalOutcome,
    snapshots: window.snapshots,
    results,
  });
}
