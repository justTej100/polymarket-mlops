"use client";

import { useState } from "react";
import type { CopyStatus } from "@/lib/trading/copyTrader";
import type { StrategySignalPayload } from "@/lib/hooks/useLiveStream";

function time(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function CopyTradingPanel({
  copy,
  strategies,
}: {
  copy: CopyStatus;
  strategies: StrategySignalPayload[];
}) {
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stakeInput, setStakeInput] = useState<string | null>(null);

  const stake = stakeInput ?? String(copy.stakeUsd);

  const update = async (config: { enabled?: boolean; strategyId?: string; stakeUsd?: number }) => {
    setSaving(true);
    try {
      await fetch("/api/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <div className={`copy ${copy.enabled ? "copy--live" : ""}`}>
      <div className="copy__header">
        <div className="copy__title-wrap">
          <h2 className="copy__title">Copy Trading</h2>
          <span className={`copy__badge ${copy.enabled ? "copy__badge--live" : "copy__badge--off"}`}>
            {copy.enabled ? "LIVE — REAL MONEY" : copy.available ? "ready" : "not connected"}
          </span>
        </div>
        {copy.address && <span className="copy__address">{copy.address.slice(0, 6)}...{copy.address.slice(-4)}</span>}
      </div>

      {!copy.available ? (
        <div className="copy__setup">
          <p className="copy__setup-lead">
            Mirror one strategy&apos;s trades with real money on your Polymarket account. To
            connect, add your keys to <code>.env</code> and restart:
          </p>
          <pre className="copy__setup-code">{`POLYMARKET_PRIVATE_KEY="0x..."      # Polymarket -> profile -> Settings -> Export private key
POLYMARKET_FUNDER_ADDRESS="0x..."   # your Polymarket deposit address (holds your USDC)
POLYMARKET_SIGNATURE_TYPE="1"       # 1 = email login (default), 2 = browser wallet`}</pre>
          <p className="copy__setup-note">
            Keys stay on your machine — they are only read server-side from .env, never sent to the
            browser.
          </p>
        </div>
      ) : (
        <>
          <div className="copy__controls">
            <label className="copy__field">
              <span className="copy__field-label">Copy this strategy</span>
              <select
                value={copy.strategyId}
                disabled={saving}
                onChange={(e) => update({ strategyId: e.target.value })}
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="copy__field">
              <span className="copy__field-label">Stake per trade (USD)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={stake}
                disabled={saving}
                onChange={(e) => setStakeInput(e.target.value)}
                onBlur={() => {
                  const value = Number(stake);
                  if (Number.isFinite(value)) update({ stakeUsd: value });
                  setStakeInput(null);
                }}
              />
            </label>

            <div className="copy__toggle-wrap">
              {copy.enabled ? (
                <button className="copy__toggle copy__toggle--stop" disabled={saving} onClick={() => update({ enabled: false })}>
                  Stop copying
                </button>
              ) : confirming ? (
                <button className="copy__toggle copy__toggle--confirm" disabled={saving} onClick={() => update({ enabled: true })}>
                  Confirm — trade real money
                </button>
              ) : (
                <button className="copy__toggle" disabled={saving} onClick={() => setConfirming(true)}>
                  Start copying
                </button>
              )}
              {confirming && !copy.enabled && (
                <button className="copy__toggle copy__toggle--cancel" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <p className="copy__warning">
            {copy.enabled
              ? `Every ${copy.strategyName} entry buys ~$${copy.stakeUsd} of the real market; exits sell it back. Wins settle on-chain.`
              : "Copying is off. Orders are only placed while this is on and the server is running."}
          </p>
        </>
      )}

      {copy.lastError && <p className="copy__error">{copy.lastError}</p>}

      {copy.orders.length > 0 && (
        <div className="copy__orders">
          {copy.orders.map((order, i) => (
            <div key={i} className={`copy__order copy__order--${order.status}`}>
              <span className="copy__order-time">{time(order.timestamp)}</span>
              <span className={`copy__order-action copy__order-action--${order.action.toLowerCase()}`}>
                {order.action}
              </span>
              <span className="copy__order-detail">{order.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
