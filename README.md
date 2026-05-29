# polymarket-mlops

A MLOps system for automated prediction market trading on [Polymarket](https://polymarket.com). Combines 9 short-horizon trading strategies, a multi-agent LLM analyst framework, real-time signal pipelines, and full MLOps infrastructure — built to demonstrate skills in MLOps engineering, AI agent systems, and real-time data pipelines.

> **Disclaimer:** All strategies run in paper-trading (simulation) mode by default. This project is for educational and portfolio purposes. Prediction market trading carries significant financial risk.

---

## What this project does

The system monitors Polymarket's 5-minute, 15-minute, and 1-hour BTC/ETH/SOL/XRP binary Up/Down markets and makes automated trading decisions by combining three layers:

**Layer 1 — Multi-agent LLM analysis (TradingAgents)**
A panel of specialized AI agents (Technical Analyst, Sentiment Analyst, News Analyst, Fundamentals Analyst, Bull Researcher, Bear Researcher, Trader, Risk Manager, Portfolio Manager) debate market conditions using LangGraph and produce a structured BUY/SELL/HOLD decision with reasoning.

**Layer 2 — Real-time ML signal classification**
An XGBoost regime classifier trained on live market features (MACD, RSI, VWAP, order book imbalance) determines which of the 9 strategies is appropriate for current market conditions. Uses online learning (River) to adapt to concept drift.

**Layer 3 — 9 executable trading strategies**
Each strategy runs as an isolated service and receives signals from layers 1 and 2 before placing paper orders via the Polymarket CLOB API.

**Copytrade layer**
A TypeScript bot mirrors trades from profitable Polymarket wallets, feeding additional training data into the ML pipeline.

Every decision — agent reasoning, feature values, signal confidence, strategy outcome — is logged to MLflow. A Grafana dashboard shows live system state. Prefect orchestrates weekly model retraining.

---

## The 9 strategies

| # | Strategy | Timeframe | Edge type |
|---|----------|-----------|-----------|
| 1 | 1¢ Buy — ultra-cheap dislocation | 5 min | Tail payoff |
| 2 | 99¢ Sniper — near-resolution strike | 5 min | Near-arb |
| 3 | Low-side dual reversion | 5 min | Mean-revert |
| 4 | Pre-order market — queue positioning | 5/15 min | Queue priority |
| 5 | Cross-market bot — spread & hedge | 5 min | Lead-lag |
| 6 | Martingale & anti-martingale ~45¢ | 15 min | Regime-based |
| 7 | Fibonacci strategy bot | 15 min | Level-based |
| 8 | Binary momentum — MACD/RSI/VWAP | 5/15 min | Multi-indicator |
| 9 | Dump-hedge — sharp move arbitrage | 5 min | Reactive arb |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Data Ingestion                        │
│  Binance WebSocket (spot price) ──► Kafka topic          │
│  Polymarket CLOB (order book)  ──► Kafka topic          │
│  Copytrade bot (TypeScript)    ──► trade log            │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Feature Pipeline                         │
│  Python consumers compute MACD, RSI, VWAP, book         │
│  imbalance → write to Redis (hot) + TimescaleDB (cold)  │
└─────────────┬───────────────────┬───────────────────────┘
              │                   │
┌─────────────▼──────┐  ┌─────────▼──────────────────────┐
│  TradingAgents     │  │  XGBoost Regime Classifier      │
│  LLM agent panel   │  │  + River online learning        │
│  (LangGraph)       │  │  FastAPI /signal endpoint       │
└─────────────┬──────┘  └─────────┬──────────────────────┘
              │                   │
┌─────────────▼───────────────────▼───────────────────────┐
│              FastAPI Signal Service                       │
│  Merges agent decision + ML signal → confidence score   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│           9 Strategy Executors (Docker pods)             │
│  Each strategy receives signal, places paper orders      │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Observability & MLOps                        │
│  MLflow: every decision logged with features + outcome   │
│  Prometheus: metrics scraping                            │
│  Grafana: live dashboard (localhost:3000)                │
│  Prefect: weekly retraining pipeline                     │
└─────────────────────────────────────────────────────────┘
```

---

## Tech stack

| Category | Tools |
|----------|-------|
| Streaming | Kafka (via Docker), Binance WebSocket |
| Feature store | Redis (hot), TimescaleDB (cold), Parquet/S3 (archive) |
| ML | XGBoost, scikit-learn, River (online learning) |
| LLM agents | TradingAgents, LangGraph, Claude / Gemini / GPT |
| RAG | ChromaDB, sentence-transformers |
| Experiment tracking | MLflow |
| Orchestration | Prefect |
| Serving | FastAPI, Uvicorn |
| Monitoring | Prometheus, Grafana |
| Infrastructure | Docker, Docker Compose, Kubernetes (k3s) |
| Copytrade bot | TypeScript, Node.js v20 |
| Language | Python 3.11+, TypeScript |

---

## Prerequisites

You need the following installed on your machine before starting.

### Ubuntu / Debian Linux

#### 1. Remove any old Docker installs

```bash
sudo apt remove docker docker-engine docker.io containerd runc 2>/dev/null; echo "done"
```

#### 2. Add Docker's apt repo

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

#### 3. Install Docker Engine + Compose plugin

```bash
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

#### 4. Run Docker without sudo

```bash
sudo usermod -aG docker $USER && newgrp docker
```

Verify:

```bash
docker run hello-world
```

You should see "Hello from Docker!".

#### 5. Install Git and VS Code

```bash
sudo apt install -y git && git --version
```

```bash
sudo snap install code --classic
```

#### 6. Install / upgrade Node.js to v20+

```bash
node --version
```

If below v20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs && node --version
```

#### 7. Install Python venv support

```bash
sudo apt install -y python3-venv python3-dev
```

### macOS

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install git node python@3.11
brew install --cask docker   # Docker Desktop for Mac
```

Start Docker Desktop from your Applications folder before continuing.

### Windows

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/), [Git for Windows](https://git-scm.com/downloads), [Node.js v20 LTS](https://nodejs.org/), and [Python 3.11](https://www.python.org/downloads/). Use WSL2 (Ubuntu) for the best experience — all commands below assume a bash terminal.

---

## Installation

### 1. Clone the project and all sub-repos

```bash
mkdir ~/polymarket-mlops && cd ~/polymarket-mlops
```

```bash
git clone https://github.com/PolyTutorLab/Polymarket-5min-15min-1hour-trading-bot-strategies strategies
```

```bash
git clone https://github.com/mclaeo/polymarket-copytrade copytrade
```

```bash
git clone https://github.com/TauricResearch/TradingAgents trading-agents
```

### 2. Create and activate a Python virtual environment

```bash
cd ~/polymarket-mlops
python3 -m venv .venv && source .venv/bin/activate
```

> Run `source .venv/bin/activate` every time you open a new terminal. Your prompt will show `(.venv)` when active.

### 3. Install Python dependencies

```bash
pip install pandas numpy websocket-client kafka-python redis scikit-learn xgboost lightgbm mlflow prefect river fastapi uvicorn prometheus-client python-dotenv requests chromadb sentence-transformers langgraph langchain anthropic openai google-generativeai
```

### 4. Install TradingAgents

```bash
cd ~/polymarket-mlops/trading-agents && pip install .
cd ~/polymarket-mlops
```

### 5. Install copytrade bot dependencies

```bash
cd ~/polymarket-mlops/copytrade
npm install
cp .env.example .env
cd ~/polymarket-mlops
```

---

## Configuration

### Environment variables — TradingAgents

```bash
cp trading-agents/.env.example trading-agents/.env
```

Edit `trading-agents/.env` and add at least one LLM provider key:

```env
# Pick ONE to start — Google Gemini has a free tier (aistudio.google.com)
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
GOOGLE_API_KEY=your-key-here

# Free at alphavantage.co — used by the News and Fundamentals agents
ALPHA_VANTAGE_API_KEY=your-key-here
```

### Environment variables — copytrade bot

Edit `copytrade/.env`:

```env
# The Polymarket wallet address you want to mirror
COPY_TARGET_USER=0xYourTargetWalletAddress

# Your own Polymarket wallet (for paper trading, use a test wallet)
POLYMARKET_PRIVATE_KEY=your-64-char-hex-private-key
POLYMARKET_ADDRESS=your-proxy-funder-address

# Risk controls
COPY_SIZE_MULTIPLIER=0.1
COPY_MAX_ORDER_USD=5
COPY_POLL_INTERVAL_MS=15000
DRY_RUN=true
```

> **Never commit `.env` files.** They are in `.gitignore` by default.

---

## Running the project

### Start all infrastructure services

This single command starts Kafka, Zookeeper, Redis, Prometheus, Grafana, and MLflow:

```bash
cd ~/polymarket-mlops
docker compose up -d
```

Verify all containers are running:

```bash
docker compose ps
```

| Service | URL |
|---------|-----|
| Grafana dashboard | http://localhost:3000 (admin / admin) |
| MLflow experiment tracker | http://localhost:5000 |
| Prometheus metrics | http://localhost:9090 |
| FastAPI signal service | http://localhost:8000/docs |

### Start the feature pipeline

In a new terminal (with venv active):

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
python signal-service/feature_pipeline.py
```

This connects to Binance WebSocket, computes MACD/RSI/VWAP in real time, and writes features to Redis.

### Start the FastAPI signal service

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
uvicorn signal-service.main:app --reload --port 8000
```

Visit http://localhost:8000/docs to see the interactive API. Key endpoints:

- `POST /signal/agent` — runs TradingAgents LLM panel for a given asset
- `POST /signal/combined` — merges LLM decision + XGBoost classifier into a confidence score

### Run a strategy (paper trading mode)

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
python strategies/strategy_8_momentum.py --dry-run
```

All strategies default to `--dry-run` (no real orders placed).

### Start the copytrade bot

```bash
cd ~/polymarket-mlops/copytrade
npm run dev
```

The bot polls your target wallet every 15 seconds and logs mirrored trades to the database.

### Test TradingAgents directly

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
python3 - <<'EOF'
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG
import json

config = DEFAULT_CONFIG.copy()
config["llm_provider"] = "google"       # or "anthropic" / "openai"
config["max_debate_rounds"] = 1

ta = TradingAgentsGraph(debug=False, config=config)
_, decision = ta.propagate("BTC", "2026-05-24")
print(json.dumps(decision, indent=2))
EOF
```

### Run the MLflow UI

MLflow starts automatically via Docker. To view experiments:

```bash
open http://localhost:5000
```

Or browse to `http://localhost:5000` in your browser. Every paper trade, model training run, and backtest is logged here with features, parameters, and metrics.

### Trigger a manual retraining run

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
python pipeline/retrain_flow.py
```

This runs the Prefect flow: pull recent data → retrain XGBoost → backtest on held-out data → promote model if accuracy improves → log to MLflow.

### Stop all services

```bash
cd ~/polymarket-mlops
docker compose down
```

---

## Project structure

```
polymarket-mlops/
├── strategies/                  # 9 Polymarket strategy executors
│   ├── strategy_1_penny_buy.py
│   ├── strategy_2_sniper.py
│   ├── strategy_3_dual_reversion.py
│   ├── strategy_4_preorder.py
│   ├── strategy_5_cross_market.py
│   ├── strategy_6_martingale.py
│   ├── strategy_7_fibonacci.py
│   ├── strategy_8_momentum.py
│   └── strategy_9_dump_hedge.py
│
├── copytrade/                   # TypeScript copytrade bot
│   ├── src/
│   ├── .env.example
│   └── package.json
│
├── trading-agents/              # TradingAgents LLM framework (TauricResearch)
│   ├── tradingagents/
│   │   └── graph/trading_graph.py
│   ├── .env.example
│   └── pyproject.toml
│
├── signal-service/              # FastAPI combining LLM + ML signals
│   ├── main.py                  # API endpoints
│   ├── feature_pipeline.py      # Binance WS → Redis
│   ├── regime_classifier.py     # XGBoost + River
│   └── rag_retriever.py         # ChromaDB strategy playbook retrieval
│
├── pipeline/
│   └── retrain_flow.py          # Prefect retraining orchestration
│
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/
│       └── dashboards/
│           └── polymarket.json  # Pre-built Grafana dashboard
│
├── rag/
│   ├── index_playbook.py        # Index 9-strategy playbook into ChromaDB
│   └── chroma_db/               # Local vector store (gitignored)
│
├── docker-compose.yml           # Kafka, Redis, Prometheus, Grafana, MLflow
├── .env.example
├── .gitignore
└── README.md
```

---

## How the signal layers work together

When a new 5-minute Polymarket market opens, the system does the following:

1. **Feature pipeline** computes MACD, RSI, VWAP, and order book imbalance from the Binance WebSocket feed and writes them to Redis (< 50ms latency).

2. **XGBoost regime classifier** reads features from Redis and returns a regime label (trending / ranging / volatile) plus which strategies are appropriate. The River online learner updates the model weights as outcomes arrive.

3. **TradingAgents** (runs on a slower cadence — once per hour per asset) produces a structured directional bias: BUY/SELL/HOLD with analyst summaries. The bull/bear researcher debate output is logged to MLflow for review.

4. **FastAPI signal service** merges the fast ML signal with the slow LLM signal into a confidence score. If both agree → full position size. If they disagree → half size or skip. The combined signal is published to a Redis channel.

5. **Strategy executors** subscribe to the Redis channel, receive the signal, apply their own entry logic (e.g. Strategy 9 waits for a 0.3% dump in 10 seconds before triggering), and place paper orders via the Polymarket CLOB client.

6. **MLflow** logs every event: features at signal time, strategy selected, entry price, exit price, PnL. This data is what Prefect uses weekly to retrain the regime classifier.

---

## RAG — strategy playbook retrieval

The 9-strategy playbook is indexed into ChromaDB so TradingAgents can query it:

```bash
cd ~/polymarket-mlops && source .venv/bin/activate
python rag/index_playbook.py
```

After indexing, the Technical Analyst agent can query: *"given BTC just dropped 0.3% in 10 seconds and the Up token is at 12¢, what does the playbook recommend?"* — and retrieve Strategy 9 (Dump-Hedge) with full execution detail.

---

## API keys needed (and cost)

| Service | Free tier | Used for |
|---------|-----------|----------|
| Google Gemini | Yes — aistudio.google.com | LLM agents (cheapest option) |
| Anthropic Claude | No — pay per token | LLM agents (highest quality) |
| OpenAI GPT | No — pay per token | LLM agents |
| Alpha Vantage | Yes — alphavantage.co | News + Fundamentals agents |
| Binance WebSocket | Yes — no key needed | Live BTC/ETH price feed |
| Polymarket API | Yes — no key needed for reads | Order book data |

> Running agents with Google Gemini's free tier is enough for development. You only need a paid LLM key for production-volume usage.

---

## Monitoring and observability

Once running, open Grafana at http://localhost:3000 (login: admin / admin).

The pre-built dashboard shows:

- Live signal confidence per strategy (0–1 scale)
- Agent decision feed: latest BUY/SELL/HOLD with timestamp and reasoning summary
- Simulated PnL over time per strategy
- Feature drift indicators: VWAP deviation, RSI distribution shift
- Model accuracy over time (from MLflow metrics)
- Kafka consumer lag (data pipeline health)

MLflow at http://localhost:5000 shows every experiment run with full parameter and metric logging. You can compare model versions, inspect feature importance, and see which strategies are performing in simulation.

---

## Skills demonstrated

This project covers the core MLOps and AI Engineer skill set that appears in the majority of 2026 job postings:

- **Real-time data pipelines** — Kafka, WebSocket ingestion, Redis feature store
- **ML model lifecycle** — XGBoost training, MLflow tracking, online learning with River, automated retraining via Prefect
- **Multi-agent LLM systems** — LangGraph, multi-provider LLM support, structured agent outputs
- **RAG** — ChromaDB vector store, document retrieval, agentic query patterns
- **Model serving** — FastAPI, signal fusion, confidence scoring
- **Containerisation and orchestration** — Docker, Docker Compose, Kubernetes-ready architecture
- **Observability** — Prometheus metrics, Grafana dashboards, structured logging
- **CI/CD** — GitHub Actions for automated testing and pipeline validation


---

## References

- [TradingAgents paper — arXiv:2412.20138](https://arxiv.org/abs/2412.20138)
- [Polymarket CLOB API docs](https://docs.polymarket.com/)
- [LangGraph documentation](https://langchain-ai.github.io/langgraph/)
- [MLflow documentation](https://mlflow.org/docs/latest/index.html)
- [Strategy playbook source](https://github.com/PolyTutorLab/Polymarket-5min-15min-1hour-trading-bot-strategies)

---

## Disclaimer

This project is for educational and research purposes only. All strategies run in simulation mode by default. Nothing in this repository constitutes financial or investment advice. Prediction markets can move to $0 or $1 instantly. Never trade with capital you cannot afford to lose.
