"use client";

import { useLiveStream } from "@/lib/hooks/useLiveStream";
import { MarketEmbed } from "@/components/MarketEmbed";
import { StrategyBoard } from "@/components/StrategyBoard";
import { StrategyExplainer } from "@/components/StrategyExplainer";

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
      <StrategyBoard signals={data?.signals ?? []} />
      <StrategyExplainer signals={data?.signals ?? []} />
    </>
  );
}
