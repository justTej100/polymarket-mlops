"use client";

import { useState } from "react";
import type { PaperPublicState } from "@/lib/worker/paperTrading";

function money(value: number, signed = false): string {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

const ACTION_LABEL: Record<string, string> = {
  BUY: "bought",
  SELL: "sold",
  WIN: "won",
  LOSS: "lost",
};

const COLUMNS: { label: string; tip: string }[] = [
  {
    label: "#",
    tip: "Rank by cash — #1 has the most actual dollars in hand right now.",
  },
  {
    label: "Strategy",
    tip: "Which of the 9 rule-based strategies this row is. Click a row to expand its full trade history.",
  },
  {
    label: "Cash",
    tip: "Regular dollars, starts at $1,000. Goes down when the strategy buys, up when it sells or a win pays out. Money sitting in an open position doesn't count until it's cashed.",
  },
  {
    label: "This window",
    tip: "Cashed-in profit or loss during the current 5-minute market. Resets when the window resolves.",
  },
  {
    label: "Total P&L",
    tip: "All-time cashed-in profit or loss this session. Only counts completed sells and settled wins/losses — never open positions.",
  },
  {
    label: "W / L",
    tip: "Windows won / lost — a W means the strategy finished a 5-minute window with more cash than it started, an L means less. Windows where it didn't trade don't count.",
  },
  {
    label: "Position",
    tip: "Money currently in play: side (UP/DOWN), share count, and the price they were bought at. — means all money is in cash.",
  },
];

function ColumnHead({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="paper__col-head" tabIndex={0}>
      {label}
      <span className="paper__col-tip" role="tooltip">
        {tip}
      </span>
    </span>
  );
}

export function PaperLeaderboard({ paper }: { paper: PaperPublicState }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lastWindow = paper.windows[0] ?? null;

  return (
    <div className="paper">
      <div className="paper__header">
        <h2 className="paper__title">Paper Trading Leaderboard</h2>
        <span className="paper__subtitle">
          every strategy trades ${paper.startingBankroll.toLocaleString()} of imaginary money · hover a column for what it means
        </span>
      </div>

      {lastWindow && (
        <div className="paper__last-window">
          <span className={`paper__outcome paper__outcome--${lastWindow.outcome.toLowerCase()}`}>
            {lastWindow.outcome}
          </span>
          <span className="paper__last-window-text">
            Last window resolved {lastWindow.outcome} —{" "}
            <strong>
              {lastWindow.results[0]?.strategyName ?? "nobody"}
            </strong>{" "}
            made the most: {money(lastWindow.results[0]?.pnlUsd ?? 0, true)}
          </span>
          <span className="paper__last-window-time">{time(lastWindow.closedAt)}</span>
        </div>
      )}

      <div className="paper__table">
        <div className="paper__row paper__row--head">
          {COLUMNS.map((col) => (
            <ColumnHead key={col.label} label={col.label} tip={col.tip} />
          ))}
        </div>

        {paper.standings.map((row, index) => {
          const expanded = expandedId === row.strategyId;
          const trades = paper.ledger.filter((t) => t.strategyId === row.strategyId);
          return (
            <div key={row.strategyId}>
              <button
                type="button"
                className={`paper__row ${expanded ? "paper__row--expanded" : ""}`}
                onClick={() => setExpandedId(expanded ? null : row.strategyId)}
              >
                <span className="paper__rank">
                  {index === 0 ? "🏆" : index + 1}
                </span>
                <span className="paper__name">{row.strategyName}</span>
                <span className="paper__equity">{money(row.bankroll)}</span>
                <span className={pnlClass(row.windowPnl)}>{money(row.windowPnl, true)}</span>
                <span className={pnlClass(row.totalPnl)}>{money(row.totalPnl, true)}</span>
                <span className="paper__wl">
                  <span className="paper__wl-w">{row.wins}</span> /{" "}
                  <span className="paper__wl-l">{row.losses}</span>
                </span>
                <span className="paper__position">
                  {row.openPositions.length === 0
                    ? "—"
                    : row.openPositions.map((p, i) => (
                        <span
                          key={i}
                          className={`paper__pos-chip paper__pos-chip--${p.side.toLowerCase()}`}
                        >
                          {p.side} {p.shares.toFixed(0)} @ {(p.entryPrice * 100).toFixed(0)}¢
                        </span>
                      ))}
                </span>
              </button>

              {expanded && (
                <div className="paper__trades">
                  {trades.length === 0 ? (
                    <div className="paper__trade paper__trade--empty">no trades yet this session</div>
                  ) : (
                    trades.map((t) => (
                      <div key={t.id} className="paper__trade">
                        <span className="paper__trade-time">{time(t.timestamp)}</span>
                        <span className={`paper__trade-action paper__trade-action--${t.action.toLowerCase()}`}>
                          {ACTION_LABEL[t.action]}
                        </span>
                        <span className={`paper__trade-side paper__trade-side--${t.side.toLowerCase()}`}>
                          {t.side}
                        </span>
                        <span className="paper__trade-fill">
                          {t.shares.toFixed(1)} shares @ {(t.price * 100).toFixed(1)}¢ ={" "}
                          {money(t.amountUsd)}
                        </span>
                        <span className="paper__trade-note">{t.note}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paper.windows.length > 0 && (
        <div className="paper__windows">
          <h3 className="paper__windows-title">Past windows</h3>
          <div className="paper__windows-list">
            {paper.windows.map((w) => (
              <div key={w.conditionId} className="paper__window">
                <span className={`paper__outcome paper__outcome--${w.outcome.toLowerCase()}`}>
                  {w.outcome}
                </span>
                <span className="paper__window-time">{time(w.closedAt)}</span>
                <span className="paper__window-winner">
                  {w.results[0]?.strategyName ?? "—"}{" "}
                  <span className={pnlClass(w.results[0]?.pnlUsd ?? 0)}>
                    {money(w.results[0]?.pnlUsd ?? 0, true)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function pnlClass(value: number): string {
  if (value > 0) return "paper__pnl paper__pnl--pos";
  if (value < 0) return "paper__pnl paper__pnl--neg";
  return "paper__pnl";
}
