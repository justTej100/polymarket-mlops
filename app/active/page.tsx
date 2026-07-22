"use client";

import { useLiveStream } from "@/lib/hooks/useLiveStream";
import { MarketEmbed } from "@/components/MarketEmbed";
import { StrategyBoard } from "@/components/StrategyBoard";
import { StrategyExplainer } from "@/components/StrategyExplainer";
import { PaperLeaderboard } from "@/components/PaperLeaderboard";
import { CopyTradingPanel } from "@/components/CopyTradingPanel";

export default function ActivePage() {
  const { data, connected } = useLiveStream();

  return (
    <>
      <p className="page-title">Live — Polymarket BTC 5-min Up/Down</p>
      <MarketEmbed
        snapshot={data?.snapshot ?? null}
        history={data?.history ?? []}
        connected={connected}
        mode="live"
      />
      {data?.paper && <PaperLeaderboard paper={data.paper} />}
      {data?.copy && <CopyTradingPanel copy={data.copy} strategies={data.signals} />}
      <StrategyBoard signals={data?.signals ?? []} />
      <StrategyExplainer signals={data?.signals ?? []} />
    </>
  );
}
