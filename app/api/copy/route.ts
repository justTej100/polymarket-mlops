import { NextResponse } from "next/server";
import { copyTrader } from "@/lib/trading/copyTrader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/copy  -> current copy-trading status
// POST /api/copy  -> update config: { enabled?, strategyId?, stakeUsd? }
// Credentials themselves only ever come from .env -- this route can't set them.

export async function GET() {
  return NextResponse.json(copyTrader.getStatus());
}

export async function POST(request: Request) {
  let body: { enabled?: boolean; strategyId?: string; stakeUsd?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const status = copyTrader.setConfig({
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    strategyId: typeof body.strategyId === "string" ? body.strategyId : undefined,
    stakeUsd: typeof body.stakeUsd === "number" ? body.stakeUsd : undefined,
  });

  return NextResponse.json(status);
}
