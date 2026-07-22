# Polymarket 9-Strategy Board

Watches Polymarket's 5-minute BTC Up/Down markets through 9 independent
rule-based trading strategies, live and in simulation, on two matching pages.

- **/active** — the current live market, streamed end-to-end (Chainlink price
  feed + Polymarket order book), no refresh needed.
- **/simulation** — the same 9 strategies replayed tick-by-tick over a real,
  recently-resolved 5-min window, with play/pause/scrub controls.

Both pages render the same UI: a live market header with real Up/Down
buy (ask) and sell (bid) prices, a Polymarket-style chart (dashed
price-to-beat line, green while Up is winning, red while Down is winning), a
strategy board, and an explainer panel describing what each strategy is
saying and why.

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
| RTDS WebSocket (`ws-live-data.polymarket.com`) | Chainlink BTC/USD price stream — the exact feed these markets resolve against, including the strike ("price to beat") |
| CLOB WebSocket + REST (`clob.polymarket.com`) | Live order book: real best bid/ask for the Up and Down tokens |
| Binance klines REST | 1-second BTC price history for the simulation page |

The Next.js server owns the live connections and pushes updates to the
browser over Server-Sent Events — the dashboard never polls, and it rolls
over to the next 5-minute market automatically.

## Why this architecture

- **One Next.js app, not Flask + a separate frontend.** All 9 strategies are
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
lib/strategies/       the 9 strategies + shared types (single source of truth)
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

## The 9 strategies

1. **Lottery Ticket** — buys the cheap side when it's deeply out of the money;
   small entries, big payoff if the late-window move reverses.
2. **Near-Certain Snipe** — buys a nearly-decided market near expiry while it
   still trades below the terminal payoff.
3. **Price Arbitrage** — buys both sides when YES + NO compress below $1.
4. **Fibonacci Retracement** — enters around retracement levels of the recent
   swing high/low.
5. **MACD Momentum** — short-window MACD on the live BTC price.
6. **RSI Momentum** — fades oversold/overbought stretches while there's time.
7. **VWAP Momentum** — leans with sustained strength above/below the window VWAP.
8. **Momentum Stacking** — requires multiple momentum indicators to align.
9. **Dump-Hedge Arbitrage** — fades sharp BTC dumps/pumps before the book
   catches up.

Each strategy is the same `(snapshot, history) => Signal` interface, so the
live pipeline, simulation replay, and backtests all evaluate the same logic.

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
