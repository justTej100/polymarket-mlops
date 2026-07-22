# Polymarket 9-Strategy Board

Watches Polymarket's 5-minute BTC Up/Down markets through 9 independent
rule-based trading strategies, live and in simulation, on two matching pages.

- **/active** — the current live market, streamed end-to-end (Chainlink price
  feed + Polymarket order book), no refresh needed.
- **/simulation** — the same strategies replayed tick-by-tick over a real,
  recently-resolved 5-min window, with play/pause/scrub controls.

Both pages render the same UI: a live market header with real Up/Down
buy (ask) and sell (bid) prices, a Polymarket-style chart (dashed
price-to-beat line, green while Up is winning, red while Down is winning), a
strategy board, and an explainer panel describing what each strategy is
saying and why.

The live page also runs a **paper-trading leaderboard**: every strategy
trades a $1,000 imaginary bankroll — entries fill at the real ask, exits at
the real bid, and open positions settle at $1/$0 when the window resolves.
The table ranks strategies by cash, counts a win when a strategy finishes a
window with more money than it started, shows per-window and total P&L, and
each row expands into a full trade ledger (when it bought/sold, at what
price, for how much). Past windows show who made the most money each round.

There's also an optional **copy-trading panel**: connect your Polymarket
account via `.env` and mirror one strategy's trades with real money (see
below).

## Quick start — .env and go

```bash
cp .env.example .env   # defaults work as-is, nothing to fill in
make install           # npm install + database init
make dev               # http://localhost:3000
```

That's it. Every data feed is public — no API keys:

| Feed | What it provides |
| --- | --- |
| Gamma API (`gamma-api.polymarket.com`) | Market discovery via the deterministic `btc-updown-5m-{timestamp}` slug |
| RTDS WebSocket (`ws-live-data.polymarket.com`) | Chainlink BTC/USD price stream — the exact feed these markets resolve against, including the strike ("price to beat") — plus ETH/USD for the cross-market strategy |
| CLOB WebSocket + REST (`clob.polymarket.com`) | Live order book: real best bid/ask for the Up and Down tokens |
| Binance klines REST | 1-second BTC price history for the simulation page |

The Next.js server owns the live connections and pushes updates to the
browser over Server-Sent Events — the dashboard never polls, and it rolls
over to the next 5-minute market automatically.

## Why this architecture

- **One Next.js app, not Flask + a separate frontend.** All strategies are
  simple rule-based functions over price/order-book data, so one TypeScript
  codebase end-to-end is simpler to build, deploy, and maintain than two.
- **Strategies share one interface** (`lib/strategies/types.ts`): every
  strategy is `(snapshot, history) => Signal`. The live pipeline and the
  backtest runner both call the exact same functions — write a strategy once,
  it works in both modes automatically.
- **The browser never polls.** The server keeps an in-memory `marketState`
  store updated on every WebSocket tick, and the dashboard subscribes to
  `/api/stream` (Server-Sent Events) to get pushed updates.
- **The database only stores what matters**, not every tick: a `Signal` row
  is written only when a strategy's direction *changes* (run `make worker`
  for that persistence loop). If `NEON_DATABASE_URL` is set, the app uses the
  Neon/Postgres Prisma client instead of local SQLite.

## Project layout

```
lib/strategies/       the strategies + shared types (single source of truth)
lib/polymarket/       Gamma discovery, live WS pipeline, historical replay data
lib/worker/           in-memory market state, the signal-persistence loop, backtests
lib/hooks/            useLiveStream — client-side SSE subscription
components/           MarketEmbed, BtcPriceChart, StrategyBoard, StrategyExplainer
app/active/           live page
app/simulation/       simulation page
app/api/stream/       SSE endpoint for the live page
app/api/backtest/     returns a historical window + backtest results
prisma/schema.prisma  Market / Signal / SignalEvent / BacktestRun tables
```

## The strategies

1. **Lottery <5¢ / <30¢ / <40¢** — three flavors of the underdog buy: after
   the first 45s, each buys the losing side below its threshold and takes
   profit when it reprices (12¢ / 45¢ / 50¢) or collects $1 on a reversal.
   Running them side by side shows where the underdog edge actually lives.
2. **99¢ Sniper** — final 60 seconds only: when spot is decisively past the
   strike and the winner still asks ≤99¢, buys the last cents of edge.
3. **Low-Side Dual Reversion** — when both sides compress into 30-48¢ and sum
   under 98¢, buys both: one must pay $1, so the discount is locked profit.
4. **Pre-Order (Opening Book)** — trades the first 45 seconds of a fresh
   window, buying both sides at the empty book's discount before the midpoint
   is discovered.
5. **Cross-Market Lag (ETH leads)** — streams Chainlink ETH/USD alongside
   BTC; when ETH moves ≥0.25% in 30s and BTC hasn't followed, buys the BTC
   market in ETH's direction ahead of the catch-up.
6. **Martingale @ 45¢** — regime-gated mid-price trading: buys dips toward
   45¢ in confirmed chop (mean reversion), rides the trending side in
   confirmed trends (anti-martingale), sits out otherwise.
7. **Fibonacci Levels** — anchors a fib grid to the token's first-90-second
   swing, buys dips into the 23.6-61.8% retracement zone, exits at the 127.2%
   extension.
8. **Momentum Confluence** — MACD + RSI + a session-average anchor on
   5-second bars of the token price, scored together; enters only at 4+
   points of agreement. (Replaces the old separate MACD/RSI/VWAP/stacking
   bots — one strategy, no duplicates.)
9. **Dump-Hedge** — reacts to ≥0.3%-in-10s BTC moves: buys the collapsed side
   instantly and hedges the other side when the pair still costs under 98¢.

Each strategy is the same `(snapshot, history) => Signal` interface, so the
live pipeline, simulation replay, and backtests all evaluate the same logic.

## Copy trading (real money — optional)

The Copy Trading panel on the live page can mirror one strategy's paper
trades onto your real Polymarket account using the official CLOB client.

1. In `.env`, fill in:
   - `POLYMARKET_PRIVATE_KEY` — Polymarket → profile → Settings → Export
     private key (or your own wallet's key if you log in with a wallet)
   - `POLYMARKET_FUNDER_ADDRESS` — your Polymarket deposit address (the one
     holding your USDC)
   - `POLYMARKET_SIGNATURE_TYPE` — `1` for email login (default), `2` for
     browser-wallet login, `0` for a raw wallet
2. Restart the server. The panel switches from setup instructions to live
   controls.
3. Pick a strategy and a per-trade stake, then press **Start copying** and
   confirm. Every entry the strategy makes buys that many dollars of the real
   market; every exit sells it back; wins settle on-chain automatically.

Safety rails: keys are read server-side from `.env` only and never reach the
browser; copying is always OFF at startup unless `COPY_TRADING_ENABLED=true`;
enabling it from the dashboard requires an explicit red confirmation step;
stakes are capped at $500 per trade. These are 5-minute binary markets —
start tiny and expect to lose what you stake.

## Commands

```bash
make dev      # dashboard (live pipeline starts on first page load)
make worker   # optional: always-on process that persists strategy signals
make test     # TypeScript checks + strategy/API tests
make build    # production build
make start    # production server
make clean    # remove local build artifacts
```

On Windows, run these through WSL: `wsl bash -lc 'cd /home/tj/pm && make dev'`.

## Deploying

1. Push to GitHub.
2. Deploy to Railway or Fly.io as an always-on Node service (the WebSocket
   connections need a long-lived process — not Vercel serverless).
3. Optionally run `npm run worker` as a second process to persist signals 24/7.
4. For a shared remote database, set `NEON_DATABASE_URL` in the environment
   and run `npm run prisma:migrate:neon` once.
