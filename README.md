# Polymarket 9-Strategy Board

Watches Polymarket's 5-minute BTC Up/Down markets through 9 independent
rule-based trading strategies, live and in simulation, on two matching pages.

- **/active** — the current live market, streamed via WebSocket, no refresh needed.
- **/simulation** — the same 9 strategies replayed tick-by-tick over a historical (or synthetic demo) 5-min window, with play/pause/scrub controls.

Both pages render the exact same UI: a live market header, a baseline board
(green YES zone above, red NO zone below, one box per strategy positioned by
its current call and confidence), and a text panel underneath explaining what
each strategy is doing and why it's currently saying what it's saying.

## Why this architecture

- **One Next.js app, not Flask + a separate frontend.** All 9 strategies are
  simple rule-based functions over price/order-book data — no ML, no Python
  data-science stack needed — so one TypeScript codebase end-to-end is
  simpler to build, deploy, and maintain than two.
- **Strategies share one interface** (`lib/strategies/types.ts`): every
  strategy is `(snapshot, history) => Signal`. The live worker and the
  backtest runner both call the exact same functions — write a strategy once,
  it works in both modes automatically.
- **An always-on worker process, not serverless functions.** The Polymarket
  WebSocket connection needs a long-lived process, which is why this is
  meant to be deployed on **Railway** or **Fly.io** (always-on Node servers),
  not Vercel (whose functions spin down and can't hold a socket open).
- **The browser never polls.** The worker keeps an in-memory `marketState`
  store updated on every WS tick, and the dashboard subscribes to
  `/api/stream` (Server-Sent Events) to get pushed updates — that's the "no
  refresh needed" auto-update.
- **The local database only stores what matters**, not every tick: a `Signal`
  row is written only when a strategy's direction *changes*, and each signal
  can now accumulate a trade ledger (`SignalEvent` rows plus realized PnL
  fields) so entries, sells, wins, and losses are all persisted without
  storing raw ticks. If `NEON_DATABASE_URL` is present, the app switches to
  the Neon/Postgres Prisma client instead of the local SQLite client.

## Project layout

```
lib/strategies/       the 9 strategies + shared types (single source of truth)
lib/polymarket/       Gamma API (market discovery), WS client (live prices),
                      historical/synthetic data (backtesting)
lib/worker/           in-memory market state, the live loop, the backtest runner
lib/hooks/            useLiveStream — client-side SSE subscription
components/           MarketEmbed, StrategyBoard, StrategyExplainer (shared by both pages)
app/active/           live page
app/simulation/       simulation page
app/api/stream/       SSE endpoint for the live page
app/api/backtest/     returns a historical/synthetic window + backtest results
prisma/schema.prisma  Market / Signal / SignalEvent / BacktestRun tables
```

## System A — 9 Independent Rule-Based Strategies

The dashboard still centers on the same nine strategies. Each one is a
separate rule-based signal with its own edge, and the UI plus database now
track both the signal and its realized outcome.

### Strategy 1 — Lottery Ticket

Buys the cheap side when it gets deeply out of the money. The edge comes from
small entries with large payoff asymmetry if the late-window move reverses.

### Strategy 2 — Near-Certain Snipe

Looks for a nearly-decided market near expiry and buys the winning side when
it still trades below the terminal payoff.

### Strategy 3 — Price Arbitrage

Watches for YES + NO compressing below $1 and buys both sides when the combined
cost leaves room for a guaranteed edge.

### Strategy 4 — Fibonacci Retracement

Finds the recent swing high/low and looks for entries around retracement levels
where the token price is likely to continue its move.

### Strategy 5 — MACD Momentum

Uses short-window MACD on the live BTC price to catch fresh momentum shifts.

### Strategy 6 — RSI Momentum

Uses RSI to spot oversold or overbought stretches and fade them when the
window still has enough time left.

### Strategy 7 — VWAP Momentum

Compares current price against the window VWAP and leans with sustained
strength above or below that anchor.

### Strategy 8 — Momentum Stacking

Requires multiple momentum indicators to line up before it becomes directional.

### Strategy 9 — Dump-Hedge Arbitrage

Reactively fades sharp BTC dumps or pumps and tries to hedge the mispricing
before the book fully catches up.

Each strategy is still the same `(snapshot, history) => Signal` interface, so
the live worker, simulation replay, and backtests all evaluate the same logic.

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:migrate
```

Run the dashboard:

```bash
npm run dev
```

Run the live worker (separate process, holds the WebSocket open):

```bash
npm run worker
```


## Makefile

The Makefile is intentionally Node/Next only. It does not start Docker,
Redis, MLflow, Prometheus, Grafana, or any Python services.

```bash
make install
make test
make build
```

From the current Windows/PowerShell environment, `make` is not available on
PATH. Run it through WSL instead:

```bash
wsl bash -lc 'cd /home/tj/pm && make test'
```

Useful targets:

- `make dev` starts the Next.js dev server.
- `make worker` starts the long-lived Polymarket stream worker.
- `npm run prisma:generate` generates the local SQLite Prisma client.
- `npm run prisma:generate:neon` generates the Neon/Postgres Prisma client.
- `make prisma-migrate` runs `prisma migrate dev`.
- `npm run prisma:migrate` runs the local SQLite migration.
- `npm run prisma:migrate:neon` runs migrations for the Neon/Postgres schema.
- `make clean` removes local build artifacts.

## Known TODOs before this is fully live-trading-real

1. **`lib/polymarket/gammaClient.ts`** — confirm the exact Gamma API query
   params for the 5-min BTC series against current docs/network tab; market
   slugs have changed before.
2. **`lib/polymarket/wsClient.ts`** — confirm the exact WS message shape
   (`price_change` / `book` event fields) against current Polymarket WS docs.
3. **`lib/polymarket/historicalClient.ts`** — wire up the real historical
   price endpoint. Until then, `/api/backtest` falls back to a clearly-labeled
   synthetic random-walk window so the simulation page works end-to-end
   locally.

None of these change any strategy logic or the UI — they're isolated to the
three files above by design.

## Deploying

1. Push to GitHub.
2. If you later want a shared remote database, swap `DATABASE_URL` to a
  hosted Postgres or SQLite path and regenerate Prisma.
3. Deploy to Railway or Fly.io as an always-on Node service if you need the
  live worker running 24/7.
4. Run `npm run worker` as a second process/service alongside `npm start`.
