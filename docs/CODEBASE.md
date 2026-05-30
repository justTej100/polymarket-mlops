# Codebase guide

This document explains **what each file does** and how data flows through the project.  
For line-by-line walkthroughs of the hottest paths, see section [Critical paths](#critical-paths).

## Architecture (one glance)

```
Binance WS + Polymarket CLOB
        │
        ▼
 feature_pipeline.py  ──► Redis (spot, book, indicators)
        │
        ▼
 System A strategies (1–9)  ──POST──►  signal_service/main.py
 System C copytrade.py     ──POST──►       │
                                           ▼
                                    paper_trader.py
                                           │
                                           ▼
                                    benchmark.py (PnL log)
                                           │
                                           ▼
                              meta_learner.py (weights A/B/C)
                                           │
                    Prometheus ◄───────────┴──────────► Grafana
```

Start everything: `make run` → [`supervisor.py`](../src/supervisor.py) spawns pipeline, API, strategies, copytrade.

---

## Root & config

| File | Purpose |
|------|---------|
| [`Makefile`](../Makefile) | `make run` bootstraps venv, Docker, app; `make test`, `make urls` |
| [`pyproject.toml`](../pyproject.toml) | Python package metadata and dependencies |
| [`.env.example`](../.env.example) | All env vars: toggles, strategy params, infra URLs |
| [`docker-compose.yml`](../docker-compose.yml) | Redis, MLflow, Prometheus, Grafana |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI: pytest + ruff on push/PR |

---

## `src/` — application code

### Entry & orchestration

| File | Purpose |
|------|---------|
| [`src/supervisor.py`](../src/supervisor.py) | **Main process manager.** Starts feature pipeline → waits for API health → spawns System A + C. Prints URL banner when ready. |
| [`src/startup.py`](../src/startup.py) | `wait_for_http_health()` — polls `/health` before workers connect. `print_service_urls()` — Grafana/API links banner. |

### `src/data/` — market data & features

| File | Purpose |
|------|---------|
| [`binance_ws.py`](../src/data/binance_ws.py) | WebSocket client for BTC/ETH/SOL/XRP spot prices. `MockBinanceWSClient` for paper mode. `pct_change()` used by strategies 5, 6, 9. |
| [`polymarket_clob.py`](../src/data/polymarket_clob.py) | **Abstract CLOB interface** + HTTP and mock implementations. `MarketInfo`, `OrderBook`, wallet leaderboard. Swap impl here if Polymarket API changes. |
| [`indicators.py`](../src/data/indicators.py) | Pure math: MACD, RSI, VWAP, book imbalance. Used by feature pipeline and strategy 8. |
| [`feature_pipeline.py`](../src/data/feature_pipeline.py) | Long-running process: reads Binance ticks + CLOB books → writes Redis keys `pm:spot:*`, `pm:book:*`, `pm:features:*`. |

### `src/signal_service/` — API hub & paper trading

| File | Purpose |
|------|---------|
| [`main.py`](../src/signal_service/main.py) | **FastAPI app** on `:8000`. Routes: `/signal/a/{id}`, `/signal/c`, `/signal/b` (stub), `/benchmark`, `/meta/weights`, `/metrics`, `/outcome`. |
| [`schemas.py`](../src/signal_service/schemas.py) | Pydantic response models so Swagger shows real JSON shapes (not `additionalProp1`). |
| [`paper_trader.py`](../src/signal_service/paper_trader.py) | Simulates orders when `DRY_RUN=true`. Enforces notional caps and session kill switch. |
| [`benchmark.py`](../src/signal_service/benchmark.py) | Tracks per-system PnL, win rate, trade log. Persists to `data/benchmark/`. |
| [`meta_learner.py`](../src/signal_service/meta_learner.py) | XGBoost + River: learns weights for systems A/B/C from resolved outcomes. Renormalizes A/C when B disabled. |
| [`feature_builder.py`](../src/signal_service/feature_builder.py) | Builds meta-learner input vector from Redis + benchmark (hour, vol, win rates, etc.). |

### `src/system_a/` — nine rule-based strategies

| File | Strategy | Entry idea |
|------|----------|------------|
| [`base_strategy.py`](../src/system_a/base_strategy.py) | Shared loop | Poll market → `evaluate()` / `evaluate_signals()` → POST to signal service |
| [`run_all.py`](../src/system_a/run_all.py) | Supervisor | Spawns each enabled `RUN_STRAT*` as subprocess; restarts on crash |
| [`strategy_1_penny_buy.py`](../src/system_a/strategy_1_penny_buy.py) | 1c Buy | Buy UP/DOWN when asks ≤ 3c after entry delay |
| [`strategy_2_sniper.py`](../src/system_a/strategy_2_sniper.py) | 99c Sniper | Buy winning side at ≤99c with <60s left |
| [`strategy_3_dual_reversion.py`](../src/system_a/strategy_3_dual_reversion.py) | Dual Reversion | Both sides compressed → locked edge if combined < $1 |
| [`strategy_4_preorder.py`](../src/system_a/strategy_4_preorder.py) | Pre-Order | Stable current market → bid next period at 45c |
| [`strategy_5_cross_market.py`](../src/system_a/strategy_5_cross_market.py) | Cross-Market | BTC lead move → buy lagging ETH/SOL/XRP |
| [`strategy_6_martingale.py`](../src/system_a/strategy_6_martingale.py) | Martingale | Mid-price adds in range (martingale) or trend (anti) |
| [`strategy_7_fibonacci.py`](../src/system_a/strategy_7_fibonacci.py) | Fibonacci | Staged bids at fib retracement levels after swing |
| [`strategy_8_momentum.py`](../src/system_a/strategy_8_momentum.py) | Momentum | MACD + RSI + VWAP confluence score ≥ threshold |
| [`strategy_9_dump_hedge.py`](../src/system_a/strategy_9_dump_hedge.py) | Dump-Hedge | Spot dump → buy cheap UP, hedge if combined ≤98c |

Each strategy reads `STRATn_*` env vars (see `.env.example` and README strategy sections).

### `src/system_c/` — copytrade

| File | Purpose |
|------|---------|
| [`wallet_ranker.py`](../src/system_c/wallet_ranker.py) | Fetches top wallets by 30d PnL from CLOB/leaderboard API |
| [`copytrade.py`](../src/system_c/copytrade.py) | Polls wallets, mirrors trades with size multiplier → `POST /signal/c` |

---

## `monitoring/` — observability

| File | Purpose |
|------|---------|
| [`prometheus.yml`](../monitoring/prometheus.yml) | Scrapes `host.docker.internal:8000/metrics` every 15s |
| [`grafana/dashboards/benchmark.json`](../monitoring/grafana/dashboards/benchmark.json) | PnL, win rate, meta weights panels |
| [`grafana/provisioning/`](../monitoring/grafana/provisioning/) | Auto-provision Prometheus datasource + dashboard |

---

## `tests/` — regression suite

| File | Covers |
|------|--------|
| [`conftest.py`](../tests/conftest.py) | FastAPI TestClient with isolated benchmark/meta fixtures |
| [`test_signal_api.py`](../tests/test_signal_api.py) | All HTTP routes, OpenAPI schema, benchmark shape |
| [`test_strategies.py`](../tests/test_strategies.py) | Each strategy's `evaluate` logic with mock CLOB/Binance |
| [`test_paper_trader.py`](../tests/test_paper_trader.py) | Caps, kill switch, resolution PnL |
| [`test_meta_learner.py`](../tests/test_meta_learner.py) | Cold start, renormalize A/C, outcome recording |
| [`test_indicators.py`](../tests/test_indicators.py) | MACD, RSI, VWAP, book imbalance math |
| [`test_feature_builder.py`](../tests/test_feature_builder.py) | Meta feature vector assembly |
| [`test_startup.py`](../tests/test_startup.py) | Health wait, URL banner |
| [`test_copytrade.py`](../tests/test_copytrade.py) | Seen-set only after successful mirror |

Run: `make test`

---

## Critical paths

### 1. Signal from strategy → benchmark

1. Strategy calls `BaseStrategy.send_signal()` → `POST /signal/a/{id}`
2. `main.signal_system_a()` → `PaperOrderSimulator.execute()`
3. `BenchmarkStore.record_trade()` appends trade, updates stats
4. Prometheus gauges refreshed via `_update_metrics()`

### 2. Market resolution → meta-learner

1. `POST /outcome` with `market_id`, `winning_side`, `winning_system`
2. `paper_trader.simulate_resolution()` marks trades won/lost, updates PnL
3. `MetaLearner.record_outcome()` trains XGBoost/River, updates weights

### 3. `make run` boot sequence

1. `Makefile` → create venv, pip install, copy `.env`, `docker compose up`
2. `supervisor.main()` → spawn feature pipeline + uvicorn
3. `wait_for_http_health()` → block until API ready
4. Spawn `run_all.py` (System A) + `copytrade.py` (System C)
5. `print_service_urls()` → print Grafana/API links

---

## Redis key reference

| Key pattern | Writer | Reader |
|-------------|--------|--------|
| `pm:spot:{asset}` | feature_pipeline | feature_builder (indirect) |
| `pm:book:{asset}` | feature_pipeline | feature_builder |
| `pm:features:{asset}` | feature_pipeline | System B (future) |
| `pm:btc:spot:history` | (optional) | feature_builder vol calc |

---

## Enabling strategies

Set in `.env`:

```env
RUN_STRAT1=true
RUN_STRAT2=true
# ... through RUN_STRAT9
```

Only strategies with `RUN_STRATn=true` are spawned by `run_all.py`.
