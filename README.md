# polymarket-mlops

A production-grade MLOps system that runs three autonomous trading systems simultaneously on [Polymarket](https://polymarket.com) prediction markets and benchmarks them in real time. A meta-learner observes all three and learns — from resolved market outcomes — which system to trust at what time of day, under what market regime.

Built from scratch. Every line of code is written here.

> **Disclaimer:** All systems run in paper-trading (simulation) mode by default. This project is for educational and portfolio purposes only. Prediction market trading carries significant financial risk.

---

## The core idea

Three fundamentally different approaches run simultaneously. Every 5-minute market that resolves gives the meta-learner a ground truth label. Over time it learns which system performs best under which conditions.

```
+---------------------+   +----------------------+   +---------------------+
|      System A       |   |       System B        |   |      System C       |
|    Rule-Based       |   |    AI Agent Panel     |   |     Copytrade       |
|    9 Strategies     |   |   (RAG + LangGraph)   |   |   Top 10 Wallets    |
|  (each independent) |   |                       |   |                     |
|                     |   |  Agents retrieve live |   |  Poll top wallets   |
|  Pure if-statements |   |  news, sentiment and  |   |  by 30-day PnL.     |
|  on live Polymarket |   |  technicals, debate,  |   |  Mirror their       |
|  CLOB + Binance WS. |   |  produce BUY/SELL/HOLD|   |  trades with a size |
|  Each runs its own  |   |  once per hour.       |   |  multiplier.        |
|  entry/exit logic.  |   |                       |   |                     |
+----------+----------+   +-----------+----------+   +----------+----------+
           |                          |                          |
           +--------------------------+--------------------------+
                                      |
                     +----------------+----------------+
                     |      FastAPI Signal Service     |
                     |  Meta-learner weights all 3    |
                     |  Logs every decision to MLflow |
                     +----------------+----------------+
                                      |
          +---------------------------+---------------------------+
          |                           |                           |
  XGBoost Meta-Learner          MLflow (all outcomes)     Grafana dashboard
  + River online updates        localhost:5000             localhost:3000
  Learns: time of day,
  regime, rolling win rate
  per system -> weights
  [A, B, C]
```

The key insight: Polymarket resolves every 5 minutes. The meta-learner gets ground truth every single resolution. Over time it learns patterns — e.g. System A's dump-hedge wins during high-volatility NY hours, System B's agents perform better in calm Asian sessions, System C copytrade lags in fast markets.

---

## Signal flows

**Autonomous mode** — Strategy fires directly to the signal service. Used for time-critical strategies (especially Strategy 9).

```
Strategy fires (if-statement) ---> FastAPI Signal Service ---> paper order
```

**Agent-reviewed mode** — Strategy signal passes through System B for LLM validation first.

```
Strategy fires ---> System B (agents validate / veto) ---> FastAPI Signal Service ---> paper order
```

Each of the 9 strategies independently decides which mode to run in, configurable per strategy.

---

## System A — 9 Independent Rule-Based Strategies

Each strategy is a **completely independent Python process** with its own:
- WebSocket connection(s)
- Entry condition logic
- Position state machine
- Take-profit and stop-loss rules
- Risk controls
- MLflow logging

They share nothing at runtime. You can run any combination — all 9, just one, or any subset. Each strategy sends its signal to the FastAPI signal service independently.

---

### Strategy 1 — 1c Buy (Ultra-Cheap Dislocation)

> **One-line idea:** Pay 1-3c for lottery tickets on both sides; collect on reversals or volatility spikes.

#### The edge

A side trading at **1c** implies roughly a 1% probability of winning. But in a 5-minute BTC market, tail events are systematically underpriced. Any 30-second candle that crosses the strike in the final minute can flip the entire outcome. The order book cannot price this accurately in real time.

Three scenarios generate profit:

| Scenario | How it profits |
|----------|----------------|
| Full reversal | The side bought at 1c wins outright and pays $1.00 — a 99x return |
| Mid-flight repricing | The side climbs to 10-15c before expiry; take profit at 10-15x entry |
| Volatility spike | Both sides reprice upward as the market becomes "live" again; sell both for combined gain |

#### Entry logic

```
TRIGGER: Market opens
WAIT:    30-60 seconds (let initial direction form)
ACTION:  Place resting limit bids at 1c, 2c, 3c on BOTH Up AND Down simultaneously
SIZE:    5-20 shares per order (small fixed notional — one side will expire worthless)
```

#### Example

```
Market: BTC-5min-UP/DOWN
BTC spot: $67,420 | Strike: $67,400 | Time remaining: 4m 30s

Up token:   1c bid placed (BTC is above strike, Up leads at 72c)
Down token: 2c bid placed

>> 2 minutes later: BTC flash-crashes to $67,350 (below strike)
   Down token reprices from 28c to 71c
   Up token collapses from 72c to 4c -- our 1c bid fills!

>> 90 seconds later: BTC bounces to $67,395
   Up token reprices to 18c

ACTION: Sell 50% of Up position at 10c (10x)
        Sell remainder at 15c or hold to expiry if BTC stays near strike
```

#### Take-profit tiers

- Sell 50% at 10c (locks in 10x on half)
- Sell remainder at 15c
- If price reaches 25c+, trail stop 5c below current price

#### Risk controls

- Cancel any **unfilled** orders in the last 30 seconds — stale orders risk filling at expiry with no time to manage
- Hard per-market notional cap (e.g. $20 total across both sides)
- Do not size up into losing streaks — the edge is statistical over hundreds of markets

#### Key parameters

```env
STRAT1_BID_LEVELS=0.01,0.02,0.03
STRAT1_ENTRY_DELAY_SECONDS=45
STRAT1_SHARES_PER_ORDER=10
STRAT1_TAKE_PROFIT_1=0.10
STRAT1_TAKE_PROFIT_2=0.15
STRAT1_CANCEL_BEFORE_EXPIRY_SECONDS=30
STRAT1_MAX_NOTIONAL_USD=20
```

---

### Strategy 2 — 99c Sniper (Near-Resolution Strike)

> **One-line idea:** Buy a side at 99c when the outcome is effectively decided but asks remain available — risk is a sudden last-second flip.

#### The edge

When BTC has drifted far from the strike with under 60 seconds remaining, the winning side often still trades at 97-99c rather than jumping to $1.00. This gap exists because:
1. Liquidity providers fear last-second moves and charge a spread even when the outcome seems certain
2. Settlement is not instantaneous — a window exists where a 99c ask can be lifted for a near risk-free 1c gain

A 99c buy settling at $1.00 earns 1c per share. On 1,000 shares that is $10 — modest, but executable in seconds with near-zero holding time.

#### Entry logic

```
TRIGGER: Time remaining <= 60 seconds
         AND underlying clearly on one side of strike
         AND ask price for winning side <= 99c
ACTION:  Market or aggressive limit buy on the winning side
HOLD:    To settlement — no active management, just collect $1.00
```

#### Example

```
Market: BTC-5min-UP/DOWN
Time remaining: 42 seconds
BTC spot: $67,680 | Strike: $67,400 (BTC is $280 ABOVE strike)

Up token ask: 99c (still available, not yet at $1.00)

ACTION: Buy 500 shares of Up at 99c
        Cost: $495

>> Settlement (42 seconds later): BTC at $67,701 -- Up wins
   Collect: $500
   Profit:  $5 (1c x 500 shares)
```

#### Tail risk

The catastrophic scenario: enter at 99c with 30 seconds left, and BTC prints a 1% candle that crosses the strike **at the bell**. The winning side collapses to 0c and you lose 99c per share. Rare but real — hence strict time and price conditions, never mechanical entry.

#### Risk controls

- Only enter when time remaining <= 60 seconds (the tighter, the safer)
- Underlying must be clearly past the strike — not within $50 of it for BTC
- Never bet full account — slippage on a market order can push effective entry above 99c and eliminate the edge
- Never use this in the first 4 minutes of a market

#### Key parameters

```env
STRAT2_MAX_TIME_REMAINING_SECONDS=60
STRAT2_MAX_ASK_PRICE=0.99
STRAT2_MIN_SPOT_DISTANCE_FROM_STRIKE=100
STRAT2_MAX_SHARES=1000
STRAT2_MAX_NOTIONAL_USD=100
```

---

### Strategy 3 — Low-Side Dual Reversion

> **One-line idea:** When both sides are compressed below 50c, buy both — at least one must win, and the compressed pricing gives you a guaranteed edge if both fill.

#### The edge

In a fair binary market with no information edge, both Up and Down should trade near 50c — together they must sum to $1.00. When both sides are trading at 35-45c simultaneously, the book is either:
- **Illiquid and wide:** Nobody is arbing the gap, so you can buy both at a discount
- **Event-anticipating:** Participants expect a sharp move and nobody wants exposure — the compression itself is tradeable

Buying both at 40c costs **80c** for a guaranteed $1.00 terminal payoff — a locked **20c edge** provided both orders fill.

#### Entry logic

```
TRIGGER: max(Up ask, Down ask) <= 48c
         AND min(Up ask, Down ask) >= 30c
         AND time remaining >= 120 seconds (avoid late-game asymmetric fills)
ACTION:  Post limit bids on BOTH Up AND Down simultaneously
TARGET:  Combined cost < $1.00 (e.g. 44c + 44c = 88c -> locked 12c edge)
```

#### Example

```
Market: BTC-5min-UP/DOWN  |  Time remaining: 3m 45s
BTC spot: $67,410  |  Strike: $67,400 (BTC is barely above, outcome uncertain)

Up token ask:  43c
Down token ask: 44c
Combined cost: 87c  <  $1.00  ->  TRIGGER

ACTION: Post limit bid 43c on Up (200 shares = $86)
        Post limit bid 44c on Down (200 shares = $88)

>> Both fill within 20 seconds

>> Market resolves: BTC closes at $67,388 (DOWN wins)
   Up:   200 shares x $0.00 =   $0
   Down: 200 shares x $1.00 = $200
   Total collected: $200
   Total cost:      $174
   Profit:           $26 (locked at entry, regardless of which side won)
```

#### Fill management

- If only **one side fills** and the other side's ask rises above breakeven, cancel the unfilled order and manage the single position as a directional bet
- Even without full fill: a side bought at 40c that reprices to 50c is a 25% return in minutes — take partial profit at midpoint

#### Risk controls

- Both legs treated as a single trade — if one fills at a bad price, re-evaluate the entire trade
- Only enter when both sides are truly compressed — avoid when one side is clearly dominant (e.g. 70c / 30c split)
- Best in the first 60-120 seconds of a market before the midpoint is discovered

#### Key parameters

```env
STRAT3_MAX_ASK_EITHER_SIDE=0.48
STRAT3_MIN_ASK_EITHER_SIDE=0.30
STRAT3_MAX_COMBINED_COST=0.98
STRAT3_MIN_TIME_REMAINING_SECONDS=120
STRAT3_MAX_NOTIONAL_PER_SIDE_USD=100
```

---

### Strategy 4 — Pre-Order Market (Queue Positioning)

> **One-line idea:** Place limit orders on the NEXT market window before it opens to capture the first liquidity when the new period starts.

#### The edge

Each 5-minute market is created fresh at UTC period boundaries. In the first 10-30 seconds of a new market, **the order book is empty**. Whoever has a resting order already placed has zero competition for fills. Early fills consistently get better prices than participants who enter after equilibrium is found.

This is queue sniping at market creation — analogous to placing a limit order on a new equity IPO before the open auction clears.

#### Entry logic

```
TIMING:  Last 1-2 minutes of the CURRENT market
SIGNAL:  Current market must be "stable" — both sides trading 35-65c
         (If current market is 90c/10c, the next market may open in continuation
          mode and adversely select a 45c pre-order immediately)
ACTION:  Identify the slug of the NEXT period
         Post limit bids at 45c on both Up and Down of the next market
MANAGE:  When new market opens and fills begin arriving, manage as below
```

#### Example

```
Current market: BTC-5min (period ending in 90 seconds)
Up: 52c | Down: 48c  -> stable (both between 35-65c)  ->  TRIGGER

ACTION: Find next period market ID
        Post bid 45c x 100 shares on Next-Period Up   = $45 at risk
        Post bid 45c x 100 shares on Next-Period Down  = $45 at risk

>> New period opens. BTC spot: $67,405 | New strike: $67,405

>> Both sides fill at 45c (combined 90c for guaranteed $1.00 -> locked 10c edge)

>> Market trends: Up reaches 85c at the 2-minute mark
   ACTION: Sell Down position at 15c (recover $15 of the $45 cost)
           Hold Up to $1.00 settlement
   
   Collected: $100 (Up) + $15 (Down partial) = $115
   Cost:      $90
   Profit:    $25
```

#### Post-fill management

- If **both sides fill below 50c combined**: locked arb. When one side climbs to 90c+, sell the losing side at whatever price is available (even 2-5c clears cost basis) and hold the winner to $1.00
- If **only one side fills**: naked directional bet — hold if trending your way, cut if it moves against you past your danger threshold

#### Risk controls

- Never pre-order when the current market is heavily one-sided (>70c / <30c)
- Signal filter is non-negotiable — without it, your limit order becomes the only available price and gets adversely selected immediately
- Per-market notional cap applies to both pre-order legs combined

#### Key parameters

```env
STRAT4_CURRENT_MARKET_STABLE_MIN=0.35
STRAT4_CURRENT_MARKET_STABLE_MAX=0.65
STRAT4_PRE_ORDER_PRICE=0.45
STRAT4_ENTRY_WINDOW_SECONDS_BEFORE_CLOSE=120
STRAT4_SHARES_PER_SIDE=100
STRAT4_MAX_NOTIONAL_USD=100
```

---

### Strategy 5 — Cross-Market Bot (Spread and Hedge)

> **One-line idea:** Link two or more related markets — same asset different horizons, or correlated assets — to extract lead-lag, spread, or hedge-style returns.

#### The edge

Polymarket runs simultaneous 5-minute markets for BTC, ETH, SOL, and XRP. These assets are highly correlated on short timeframes. When BTC makes a sharp move up, ETH, SOL, and XRP typically follow within seconds. The cross-market bot monitors all four simultaneously and routes signals from the faster-moving asset to trade the lagging asset before prices adjust.

The lag between BTC leading and altcoins following is typically **5-30 seconds** — enough to enter and profit.

#### Three variants

**Variant A — Correlation Signal (Lead-Lag)**

```
MONITOR: BTC spot price via Binance WebSocket
TRIGGER: BTC crosses its own Polymarket strike cleanly
         AND ETH/SOL/XRP markets have NOT yet repriced
ACTION:  Place aggressive buy on ETH (or SOL or XRP) in the same direction
EDGE:    Enter before the altcoin market reprices to follow BTC
```

**Variant B — Paired Hedge**

```
POSITION: Long Up in BTC-5m current period
          Long Down in ETH-5m current period (opposite risk)
PROFIT:   Spread compression — if BTC and ETH move together, legs cancel;
          profit comes from one market being mispriced relative to the other
```

**Variant C — Calendar Spread**

```
POSITION: Buy current BTC-5m Down at 40c
          Buy next-period BTC-5m Down's opposing leg at 52c
PROFIT:   Mean reversion in implied probability between the two periods
```

#### Example (Variant A)

```
Monitoring: BTC, ETH, SOL, XRP simultaneously

>> BTC spot: +0.4% in 8 seconds, crosses BTC strike at $67,400
   BTC Up token: reprices from 52c to 74c (already moved)

>> ETH Up token: still at 51c (has NOT repriced yet — 12 second lag)
   SOL Up token: still at 49c

ACTION: Buy ETH-5m Up aggressively at 53c (market order, accept slippage)
        Buy SOL-5m Up aggressively at 51c

>> 15 seconds later: ETH and SOL markets reprice following BTC
   ETH Up: 68c  |  SOL Up: 65c

EXIT: Sell ETH Up at 68c  (profit: 15c per share)
      Sell SOL Up at 65c  (profit: 14c per share)
```

#### Risk controls

- Always model worst case as **zero correlation** when sizing — correlation breakdown (e.g. SOL flash crash independent of BTC) causes both positions to lose simultaneously
- Maximum concurrent exposure across all cross-market positions combined
- Only enter when the lag asset has genuinely not repriced — if it has already moved 80% of the expected move, the edge is gone

#### Key parameters

```env
STRAT5_LEAD_ASSET=BTC
STRAT5_LAG_ASSETS=ETH,SOL,XRP
STRAT5_MIN_LEAD_MOVE_PCT=0.25
STRAT5_MAX_LAG_SECONDS=30
STRAT5_AGGRESSIVE_LIMIT_SLIPPAGE=0.03
STRAT5_MAX_NOTIONAL_PER_PAIR_USD=75
```

---

### Strategy 6 — Martingale and Anti-Martingale at 45c

> **One-line idea:** Around mid-prices (~45c), either progressively add on adverse moves (martingale) or pyramid into strength and cut weakness (anti-martingale). Both require strict regime gating.

#### Why 45c is the arena

At mid-prices, a binary market is saying "50/50 — we don't know." This is where the highest uncertainty and therefore the most mean-reversion potential exists. Prices around 45c are also far enough from terminal values ($0 or $1) that multiple waves of price movement can occur before expiry.

#### Martingale variant

```
REGIME GATE: Only in confirmed range/chop — NOT in trending markets
             (BTC has not made a sustained directional move in last 2 minutes)

ENTRY:  Buy at 45c
ADD 1:  If price drops to 38c, buy same size again (avg cost ~41.5c)
ADD 2:  If price drops to 30c, buy same size again (avg cost ~37.7c)
PROFIT: Price reverts above average cost before expiry
```

**Example:**

```
Market: BTC-5min-UP  |  BTC ranging: $67,390 - $67,415 for 90 seconds
Up token: 45c  ->  BUY 100 shares at 45c  ($45)

>> BTC dips to $67,378, Up token drops to 37c
ADD: Buy 100 more shares at 37c  ($37)
Avg cost: 41c

>> BTC recovers to $67,402, Up token reprices to 52c
EXIT: Sell all 200 shares at 52c  ($104)
Cost: $82
Profit: $22
```

**Hard rules for martingale:**
- Maximum 3 add-on levels — never add a 4th
- Total notional cap: no more than 5% of session budget per market
- Auto-liquidate if position drops below hard stop (e.g. if avg cost is 38c and price hits 15c — sell at market, no exceptions)
- **NEVER apply in a trending market** — a 30c side goes to 5c then 0c in a strong trend, and martingale on a binary trend is catastrophic

#### Anti-Martingale variant

```
REGIME GATE: Only in confirmed trending markets
             (BTC making sustained directional move, not ranging)

ENTRY:  Buy at 45c
ADD 1:  If price confirms direction by moving to 52c (+7c), add 50% of initial size
ADD 2:  If price confirms again at 58c, add another 50% of initial size
TRAIL:  If price ever retraces more than half the gain from entry,
        sell the adds but keep the original position
```

**Example:**

```
Market: BTC-5min-UP  |  BTC trending up: +0.5% in 2 minutes
Up token: 44c  ->  BUY 100 shares at 44c  ($44)

>> BTC continues up, Up token reaches 52c  (+8c confirmed)
ADD: Buy 50 more shares at 52c  ($26)

>> BTC still trending, Up token reaches 61c
ADD: Buy 50 more shares at 61c  ($30.50)

>> Up token reaches 75c with 90 seconds remaining
TRAIL STOP: Set at 62c (half the gain from 44c entry)

>> Settles at 82c (time running out, take profit before potential reversal)
EXIT: Sell all 200 shares at 78c (limit)
Total collected: $156
Total cost:      $100.50
Profit:          $55.50
```

#### Key parameters

```env
STRAT6_MODE=martingale                    # martingale | anti_martingale | auto
STRAT6_ENTRY_PRICE=0.45
STRAT6_ENTRY_RANGE=0.03                   # enter between 0.42-0.48
STRAT6_MARTINGALE_ADD_LEVELS=3
STRAT6_MARTINGALE_TRIGGER_DROPS=0.07,0.08 # add at -7c, add again at -8c more
STRAT6_MARTINGALE_HARD_STOP=0.15
STRAT6_ANTI_CONFIRM_MOVE=0.07             # add after +7c confirmation
STRAT6_ANTI_TRAIL_STOP_PCT=0.50           # trail stop at 50% of gain
STRAT6_MAX_NOTIONAL_USD=150
STRAT6_REGIME_LOOKBACK_SECONDS=120
```

---

### Strategy 7 — Fibonacci Strategy Bot

> **One-line idea:** Use Fibonacci retracement and extension levels anchored to the swing high/low of the first 60-90 seconds to determine staged entry prices and take-profit targets.

#### Applying Fibonacci to binary token prices

In a 5-minute binary market, the "price" being analyzed is the **Up/Down token price** (0 to $1), not the underlying BTC price. Fibonacci levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) are calculated on the token's own price swing.

#### Setup

```
STEP 1: Let market run for first 60-90 seconds
STEP 2: Identify swing High and swing Low of the token price
STEP 3: Calculate Fibonacci retracement levels
STEP 4: Place staged limit buy orders at key retracement levels
STEP 5: Set take-profit targets at Fibonacci extension levels
```

#### Example

```
Market: BTC-5min-UP  |  First 90 seconds observed:
Up token High: 58c  |  Low: 42c  |  Range: 16c

Fibonacci retracements of the DOWN move (buying the dip):
  23.6%:  42 + (0.236 x 16) = 45.8c  -> bid at 46c
  38.2%:  42 + (0.382 x 16) = 48.1c  -> bid at 48c
  50.0%:  42 + (0.500 x 16) = 50.0c  -> bid at 50c

ACTION: Place limit bids at 46c (100 shares), 48c (75 shares), 50c (50 shares)
        (larger size at deeper retracement where value is better)

>> Price dips to 44c, all three levels fill
   Total: 225 shares at avg cost of 47.5c

Fibonacci extensions (take-profit targets):
  127.2%:  58 + (0.272 x 16) = 62.4c  -> sell 50% at 62c
  161.8%:  58 + (0.618 x 16) = 67.9c  -> sell remaining at 68c

>> Up token rallies to 64c
   SELL: 112 shares at 62c  ($69.44)

>> Up token continues to 71c
   SELL: 113 shares at 68c  ($76.84)

Total collected: $146.28
Total cost:      $106.88
Profit:          $39.40
```

#### Binary payoff cap

Unlike traditional assets, payoff is capped at $1.00. Any Fibonacci extension that calculates above 90c is irrelevant — once the token hits 90c+, treat it as **Strategy 2 (99c Sniper) territory**. The effective extension target range is always 85-99c regardless of what Fibonacci math suggests.

#### Risk controls

- Stagger entries across Fibonacci levels rather than all-in at one price
- If the swing low is broken (price drops below the original 42c low in the example), invalidate the setup and cancel all unfilled bids
- Time gate: Do not place Fibonacci bids in the last 90 seconds — not enough time to manage staged entries

#### Key parameters

```env
STRAT7_SWING_OBSERVE_SECONDS=90
STRAT7_FIB_LEVELS=0.236,0.382,0.500,0.618
STRAT7_EXTENSION_TARGETS=1.272,1.618
STRAT7_SIZE_LARGEST_LEVEL=100
STRAT7_SIZE_SCALE_FACTOR=0.75           # each level gets 75% of the previous
STRAT7_INVALIDATION_BUFFER=0.02         # cancel if price breaks swing low by 2c
STRAT7_MIN_TIME_REMAINING_SECONDS=90
STRAT7_MAX_NOTIONAL_USD=120
```

---

### Strategy 8 — Binary Momentum (MACD / RSI / VWAP)

> **One-line idea:** Stack three indicators on the binary token price to generate high-conviction directional signals — only enter when 3 or more indicators agree.

#### The three indicators and their roles

**MACD — Trend Impulse**
Applied to rolling binary token price (5-second bars for a 5-minute market). A bullish MACD crossover on the Up token signals accelerating upward price pressure — the market is starting to agree that Up will win.
- Parameters: Fast EMA 3-bar, Slow EMA 8-bar, Signal 3-bar (adjusted for short timeframe)
- Signal: Enter Up when MACD line crosses above signal line and histogram turns positive

**RSI — Stretch and Mean-Revert Filter**
RSI on 5-second bars measures whether the token price has moved too far too fast.
- RSI above 75: price is overstretched — warning, do not chase momentum
- RSI below 30: potential mean-reversion entry
- Use RSI as a **filter not a primary signal** — only enter MACD trades when RSI is in the 40-65 range
- Use RSI extremes (<25 or >75) as **exit signals** — take profit or tighten stops

**VWAP — Intraday Fair Value**
VWAP of the binary token price within the 5-minute window provides a volume-weighted fair value anchor.
- Price above VWAP = buying pressure, below VWAP = selling pressure
- Enter longs when token price is above VWAP and MACD confirms
- Avoid new entries when price is extended more than 8-10c from VWAP
- If price pulls back to VWAP during an established trend — reload opportunity, not danger sign

#### Confluence scoring

Rather than requiring all three simultaneously (too rare), score them:

| Signal | Score |
|--------|-------|
| MACD bullish crossover | +2 |
| RSI 40-65 (neutral zone) | +1 |
| Price above VWAP | +1 |
| MACD histogram increasing | +1 |

**Enter when score >= 4. Exit or reduce when score drops below 2.**

This allows graduated position sizing rather than binary on/off.

#### Example

```
Market: BTC-5min-UP  |  Time remaining: 3m 10s
5-second bars of Up token price being tracked

Current readings:
  MACD:  Line just crossed above signal line (+2)
         Histogram turned positive (+1)
  RSI:   54 -- neutral zone (+1)
  VWAP:  Token at 53c, VWAP at 50c -- above VWAP (+1)

SCORE: 5/5  -> STRONG ENTRY SIGNAL

ACTION: Buy Up token aggressively at 54c (100 shares)

>> 45 seconds later:
   MACD: Still bullish (+2), histogram growing (+1)
   RSI:  68 -- approaching overbought (0, but not exit yet)
   VWAP: Token at 63c, VWAP at 53c -- extended (+1)
   SCORE: 4/5 -- still holding

>> 60 seconds later:
   RSI:  78 -- OVERBOUGHT EXIT SIGNAL
   ACTION: Sell 50% at 67c (partial take-profit)

>> Final 30 seconds:
   SCORE drops to 2 -- exit remaining
   ACTION: Sell remainder at 71c

Total collected: (50 x 0.67) + (50 x 0.71) = $33.50 + $35.50 = $69
Cost: 100 x 0.54 = $54
Profit: $15
```

#### Key parameters

```env
STRAT8_BAR_SECONDS=5
STRAT8_MACD_FAST=3
STRAT8_MACD_SLOW=8
STRAT8_MACD_SIGNAL=3
STRAT8_RSI_PERIOD=14
STRAT8_RSI_NEUTRAL_LOW=40
STRAT8_RSI_NEUTRAL_HIGH=65
STRAT8_RSI_OVERBOUGHT=75
STRAT8_RSI_OVERSOLD=25
STRAT8_VWAP_STRETCH_LIMIT=0.10
STRAT8_MIN_SCORE_TO_ENTER=4
STRAT8_EXIT_SCORE_THRESHOLD=2
STRAT8_MAX_NOTIONAL_USD=100
```

---

### Strategy 9 — Dump-Hedge (Sharp Move Arbitrage)

> **One-line idea:** When a sharp underlying move sends one side to near-zero, buy the fallen side first; then hedge the other side when the combined pair cost clears your edge threshold.

#### The edge

A sudden BTC dump sends the Up token from 55c to **8c** in ten seconds. The market is now pricing an 8% probability for Up. At the same time, Down has repriced from 45c to 88c. The book has moved violently and, critically, **not all stale quotes have been pulled yet**.

This creates a window (often 5-15 seconds) where you can:
1. Buy the collapsed Up token at 8-12c (leveraged on a potential reversal)
2. Buy the elevated Down token at a still-reasonable 85-88c

Combined cost: 10c + 86c = **96c** for a guaranteed $1.00 payout = **4c locked edge** if both fill.

**Always runs in autonomous mode — zero agent review, zero delay.**

#### Four-phase execution

**Phase 1 — Dump detection:**
```
MONITOR: BTC spot price via Binance WebSocket (real-time)
TRIGGER: Price drops >= X% in <= Y seconds
         AND Up token drops below threshold (e.g. 20c)
DEFAULT: 0.3% drop in 10 seconds AND Up token < 20c
```

**Phase 2 — First leg (fallen side):**
```
ACTION:  Market or aggressive limit buy on collapsed Up token IMMEDIATELY
TARGET:  Entry price <= 15c
         Above 20c, expected value drops sharply -- skip if market has recovered
SIZE:    Moderate -- this leg has high variance if not paired
```

**Phase 3 — Hedge assessment:**
```
AFTER FIRST FILL:
  Calculate combined cost = Up fill price + Down current ask
  If combined cost < 98c  ->  place Down hedge immediately (locked edge)
  If Down has already repriced to 99c+  ->  skip hedge
                                            run Up leg naked as reversal play
```

**Phase 4 — Position resolution:**
```
IF FULLY HEDGED (both filled under $1):
  Hold both to expiry, collect $1, profit = $1 minus combined cost
  No further action needed

IF SINGLE LEG (Up only):
  Take-profit tiers: sell 50% at 25c, sell remainder at 40c
  If BTC continues dumping and Up goes below 5c: cut at market (stop loss)
```

#### Example — Fully hedged

```
Monitoring: BTC at $67,500 via Binance WebSocket

>> BTC: $67,500 -> $67,298 in 9 seconds  (-0.30%)
   Up token: collapses from 54c to 9c
   DUMP DETECTED

PHASE 2:
  Buy Up token at 11c (market order, 200 shares) = $22

PHASE 3:
  Up fill: 11c
  Down current ask: 84c
  Combined cost: 11 + 84 = 95c  < 98c  ->  HEDGE
  Buy Down token at 84c (200 shares) = $168

Total cost: $22 + $168 = $190
Guaranteed payout: 200 x $1.00 = $200
LOCKED PROFIT: $10 (regardless of which direction BTC goes)
```

#### Example — Single leg (reversal play)

```
>> Same dump detected, buy Up at 11c

>> Down has already repriced to 99c -- hedge too expensive
   Running Up leg naked

>> BTC stabilizes at $67,310, starts recovering
   Up token reprices from 11c to 28c

ACTION: Sell 50% (100 shares) at 25c  ($25)

>> BTC recovers further to $67,390
   Up token at 43c

ACTION: Sell remaining 100 shares at 40c  ($40)

Total collected: $65
Total cost:      $22
Profit:          $43  (195% return on the Up leg in under 3 minutes)
```

#### Risk controls

- This strategy is purely reactive — it waits for events, never pre-positions
- First leg must fill at <= 15c. If the market has already partially recovered and Up is at 22c, skip entirely
- Hard stop on the naked single leg: if Up drops below 5c after your entry, cut at market
- Per-market notional cap: hedged positions can be sized larger (locked edge); naked legs require tighter sizing

#### Key parameters

```env
STRAT9_DUMP_PCT_THRESHOLD=0.003          # 0.3% drop
STRAT9_DUMP_WINDOW_SECONDS=10            # within 10 seconds
STRAT9_UP_TOKEN_MAX_ENTRY=0.15           # skip if Up already above 15c
STRAT9_HEDGE_MAX_COMBINED_COST=0.98      # only hedge if locked edge >= 2c
STRAT9_FIRST_LEG_SHARES=200
STRAT9_TAKE_PROFIT_1=0.25               # sell 50% at 25c
STRAT9_TAKE_PROFIT_2=0.40               # sell remainder at 40c
STRAT9_SINGLE_LEG_STOP_LOSS=0.05        # cut if Up drops below 5c
STRAT9_MAX_NOTIONAL_HEDGED_USD=200
STRAT9_MAX_NOTIONAL_NAKED_USD=50
STRAT9_MODE=autonomous                   # always autonomous -- no agent review
```

---

## Strategy comparison matrix

| Strategy | Direction | Edge type | Variance | Complexity | Best condition |
|----------|-----------|-----------|----------|------------|----------------|
| 1 — 1c Buy | Both | Tail payoff | Very high | Low | Volatile, rangebound |
| 2 — 99c Sniper | One | Near-arb | Low | Low | Near expiry, clear winner |
| 3 — Dual Reversion | Both | Mean-revert + arb | Medium | Medium | Both sides compressed |
| 4 — Pre-Order | Both | Queue priority | Medium | Medium | Stable current period |
| 5 — Cross-Market | Both | Lead-lag | Medium | High | High inter-asset correlation |
| 6 — Martingale/AM | One | Regime-based | Very high | High | Confirmed chop or trend |
| 7 — Fibonacci | One | Level-based | Medium | Medium | Clear swing in first 90s |
| 8 — MACD/RSI/VWAP | One | Multi-indicator | Medium | High | Moderate volatility |
| 9 — Dump-Hedge | Both | Reactive arb | High | High | Sharp spot move detected |

---

## Risk management (shared across all strategies)

Each strategy enforces these controls independently:

| Control | Description |
|---------|-------------|
| Per-market notional cap | Never exceed a fixed dollar amount on any single 5-minute market |
| Session drawdown kill switch | If total session loss exceeds X% of session budget, halt all new entries |
| Adverse selection monitor | Track fill rate per strategy. If a strategy fills only in losing conditions, pause and review |
| Cancel-unfilled discipline | Any order with < 20-30 seconds to expiry and no realistic fill path is cancelled |
| Correlation breakdown buffer | For cross-market strategies, always model worst case as full decorrelation |
| No martingale without regime gate | Martingale adds only permitted in confirmed range/chop — never in trending markets |

---

## System B — AI Agent Panel (RAG + LangGraph)

A multi-agent LLM system that retrieves live external data and reasons over it. This is RAG in practice — each agent retrieves specific real-time context and passes it through a structured debate pipeline.

```
Retrieval layer
--------------------------------------------------------------
Technical Analyst    retrieves live MACD/RSI/VWAP from Redis (computed by feature pipeline)
Sentiment Analyst    retrieves crypto funding rates and social sentiment
News Analyst         retrieves macro headlines via Alpha Vantage
Fundamentals Analyst retrieves on-chain metrics and exchange flows
         |
         v
Debate layer (LangGraph)
--------------------------------------------------------------
Bull Researcher --+
Bear Researcher --+--> Trader Agent --> Risk Manager --> Portfolio Manager --> Decision
         |
         v
Output
--------------------------------------------------------------
{
  "action": "BUY",
  "asset": "BTC",
  "confidence": 0.74,
  "directional_bias": "UP",
  "reasoning": "MACD bullish crossover confirmed. Funding rates neutral.
                No macro events next 2hr. Bear case: thin book above $67k.",
  "risk_assessment": "APPROVED"
}
```

Runs once per hour per asset. The hourly output sets a directional bias that System A's agent-reviewed strategies reference. Supports Claude, Gemini (free tier), and GPT.

---

## System C — Copytrade Top 10 Wallets

Polls the Polymarket API for the top 10 wallets ranked by 30-day PnL. Mirrors their open trades with a configurable size multiplier and per-order USD cap.

```env
COPY_TARGET_COUNT=10
COPY_SIZE_MULTIPLIER=0.1
COPY_MAX_ORDER_USD=5
COPY_POLL_INTERVAL_MS=15000
DRY_RUN=true
```

**Known limitation:** polling introduces ~15 second lag. For 5-minute markets this is significant. The meta-learner accounts for this — if System C consistently lags profitable entries it learns to down-weight it.

---

## The meta-learner

An XGBoost classifier inside the FastAPI signal service. Allocates confidence weights across the three systems based on what has worked historically under similar conditions.

**Feature set:**

| Feature | Why it matters |
|---------|----------------|
| Hour of day (UTC) | Asian hours favour different systems than the NY open |
| Day of week | Weekend markets have lower liquidity |
| BTC rolling 1h volatility | High vol favours dump-hedge and momentum. Low vol favours agents. |
| BTC trend strength (ADX) | Trending favours anti-martingale and cross-market |
| Order book depth | Thin books favour 1c buy and sniper strategies |
| Rolling 24h win rate — System A | How is rule-based doing today? |
| Rolling 24h win rate — System B | How are agents doing today? |
| Rolling 24h win rate — System C | How is copytrade doing today? |
| Minutes since last System B update | Agent signal staleness |

**Output:** confidence weights, e.g. `[A: 0.65, B: 0.20, C: 0.15]`

**Cold start:** Starts with equal weights `[0.33, 0.33, 0.33]` until `META_MIN_OUTCOMES_TO_LEARN` outcomes are accumulated.

**Online learning:** River updates weights after every 5-minute market resolution.

---

## Prerequisites

### Ubuntu Linux

**1. Remove any old Docker**

```bash
sudo apt remove docker docker-engine docker.io containerd runc 2>/dev/null; echo "done"
```

**2. Add Docker's GPG key and apt repo**

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

**3. Install Docker Engine and Compose plugin**

```bash
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**4. Run Docker without sudo**

```bash
sudo usermod -aG docker $USER && newgrp docker
```

```bash
docker run hello-world
```

Expected: `Hello from Docker!`

**5. Install Git, Python venv, and VS Code**

```bash
sudo apt install -y git python3-venv python3-dev
```

```bash
sudo snap install code --classic
```

**6. Verify Node.js is v20+**

```bash
node --version
```

If below v20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs && node --version
```

### macOS

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git python@3.11 node
brew install --cask docker
```

Open Docker Desktop from Applications before continuing.

### Windows

Install [WSL2 with Ubuntu](https://learn.microsoft.com/en-us/windows/wsl/install), then follow the Ubuntu instructions above inside your WSL2 terminal.

---

## Installation

**1. Clone the repo and enter the project directory**

```bash
git clone <your-repo-url> polymarket-mlops && cd polymarket-mlops
```

If you already have a local checkout, `cd` into it instead (for example `cd ~/pm`).

**2. Prerequisites on the host**

- Python **3.11+** (`python3 --version`)
- Docker (for Redis, MLflow, Prometheus, Grafana)

You do **not** need to create or activate a virtual environment manually. The Makefile creates `.venv` automatically and runs all Python commands through it.

---

## Configuration

Copy `.env.example` to `.env` and adjust as needed. Key settings for v1:

```env
# Infrastructure (defaults match docker-compose)
REDIS_URL=redis://localhost:6379/0
MLFLOW_TRACKING_URI=http://localhost:5000
SIGNAL_SERVICE_URL=http://localhost:8000

# Paper trading — leave true until you deliberately go live
DRY_RUN=true

# v1 defaults: System A (strategies 2+9) and System C on; System B stub off
RUN_SYSTEM_A=true
RUN_SYSTEM_B=false
RUN_SYSTEM_C=true

RUN_STRAT1=false
RUN_STRAT2=true
RUN_STRAT3=false   # strategies 3–8 not implemented in v1
RUN_STRAT4=false
RUN_STRAT5=false
RUN_STRAT6=false
RUN_STRAT7=false
RUN_STRAT8=false
RUN_STRAT9=true

# Feature pipeline uses mock Polymarket CLOB when DRY_RUN=true (supervisor sets this)
FEATURE_PIPELINE_MOCK=true

# Session risk (paper trader kill switch)
SESSION_BUDGET_USD=1000
SESSION_DRAWDOWN_KILL_PCT=0.10

# Meta-learner
META_COLD_START_WEIGHTS=0.33,0.33,0.33
META_MIN_OUTCOMES_TO_LEARN=50
```

LLM and wallet keys (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `POLYMARKET_PRIVATE_KEY`, etc.) are only needed when you enable System B or live trading. See `.env.example` for the full list and strategy-specific parameters.

---

## Running the project

From the project root — **one command**:

```bash
make run
```

`make run` does everything automatically:

1. Creates `.venv` if it does not exist (reuses it if it does)
2. Runs `pip install -e ".[dev]"` into that venv
3. Copies `.env.example` → `.env` if `.env` is missing
4. Starts Docker infrastructure (`docker compose up -d`)
5. Starts the supervisor (feature pipeline, API, System A, System C)

No `source .venv/bin/activate` required — Make invokes `.venv/bin/python` directly.

| Service | URL | Login |
|---------|-----|-------|
| Grafana | http://localhost:3000 | admin / admin |
| MLflow | http://localhost:5000 | — |
| Prometheus | http://localhost:9090 | — |
| FastAPI | http://localhost:8000/docs | — |

**Subsequent runs** (after the first `make run`):

```bash
make run
```

Or, if Docker is already up and you only need to restart the app:

```bash
make start
```

`make start` runs `.venv/bin/python -m src.supervisor`, which spawns:

- Feature pipeline → Redis (mock CLOB when `DRY_RUN=true`)
- FastAPI signal service on `:8000`
- System A strategies enabled via `RUN_STRAT*` (v1: 2 and 9)
- System C copytrade (when `RUN_SYSTEM_C=true`)

All orders are simulated when `DRY_RUN=true` (default).

**Makefile targets**

| Target | What it does |
|--------|----------------|
| `make run` | **Full bootstrap + run** — venv, deps, `.env`, Docker up, supervisor |
| `make setup` | venv + `pip install` + `.env` only (no Docker, no app) |
| `make start` | `setup` + supervisor (Docker must already be running) |
| `make up` | Start Docker infrastructure |
| `make down` | Stop Docker infrastructure |
| `make venv-reset` | Delete `.venv` and recreate from scratch, then reinstall on next target |
| `make test` | Run pytest (auto-uses `.venv`) |
| `make lint` | Ruff check and format check (auto-uses `.venv`) |
| `make help` | Print target summary |

To wipe and recreate the virtual environment:

```bash
make venv-reset && make run
```

**Prometheus metrics**

The signal service runs on the **host** (not in Docker). Prometheus (in Docker) scrapes `host.docker.internal:8000/metrics` per `monitoring/prometheus.yml`. This works on Docker Desktop (macOS/Windows). On **Linux**, add to the `prometheus` service in `docker-compose.yml`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Then restart: `make down && make up`.

**Manual start (optional)**

After `make setup` (so `.venv` exists):

```bash
FEATURE_PIPELINE_MOCK=true .venv/bin/python -m src.data.feature_pipeline
.venv/bin/uvicorn src.signal_service.main:app --host 0.0.0.0 --port 8000
.venv/bin/python -m src.system_a.run_all --dry-run
.venv/bin/python -m src.system_c.copytrade
```

**API endpoints**

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check |
| `POST /signal/a/{strategy_id}` | Signal from a System A strategy |
| `POST /signal/b` | System B stub (disabled in v1) |
| `POST /signal/c` | Mirrored trade from System C |
| `POST /outcome` | Record market resolution for paper PnL and meta-learner |
| `GET /benchmark` | Simulated PnL and win rate for all 3 systems |
| `GET /meta/weights` | Meta-learner confidence weights |
| `GET /metrics` | Prometheus scrape endpoint |

Example — submit a paper signal and check the benchmark:

```bash
curl -s http://localhost:8000/health

curl -s -X POST http://localhost:8000/signal/a/9 \
  -H 'Content-Type: application/json' \
  -d '{"market_id":"btc-demo","action":"BUY","side":"UP","price":0.12,"shares":100,"confidence":0.8,"mode":"autonomous"}'

curl -s http://localhost:8000/benchmark | python3 -m json.tool
```

**Stop everything**

```bash
# Ctrl+C to stop make run / make start, then:
make down
```

Watch the benchmark dashboard at http://localhost:3000.

---

## Development

From the project root — no manual venv activation:

```bash
make test      # creates .venv if needed, then pytest
make lint      # creates .venv if needed, then ruff
make setup     # venv + deps + .env only
```

Tests use an in-memory FastAPI client (`tests/conftest.py`); Docker does not need to be running for `make test`.

---

## Project structure

v1 layout (planned components marked with comments):

```
polymarket-mlops/
|
+-- src/
|   +-- supervisor.py                  # make start — spawns all host processes
|   +-- data/
|   |   +-- feature_pipeline.py        # Binance WS + Polymarket CLOB -> Redis
|   |   +-- binance_ws.py
|   |   +-- polymarket_clob.py
|   |   +-- indicators.py
|   |
|   +-- system_a/
|   |   +-- run_all.py                 # Spawns enabled strategies as subprocesses
|   |   +-- base_strategy.py
|   |   +-- strategy_2_sniper.py       # v1
|   |   +-- strategy_9_dump_hedge.py   # v1
|   |   # strategy_1, 3–8 — planned (see Roadmap)
|   |
|   +-- system_c/
|   |   +-- copytrade.py
|   |   +-- wallet_ranker.py
|   |
|   +-- signal_service/
|   |   +-- main.py                    # FastAPI routes + Prometheus /metrics
|   |   +-- meta_learner.py
|   |   +-- feature_builder.py
|   |   +-- benchmark.py
|   |   +-- paper_trader.py
|   |
|   # system_b/ — planned (LangGraph agent panel)
|   # pipeline/retrain_flow.py — planned (Prefect retraining)
|
+-- tests/                             # pytest suite (make test)
+-- monitoring/
|   +-- prometheus.yml                 # scrapes host.docker.internal:8000
|   +-- grafana/dashboards/benchmark.json
|   +-- grafana/provisioning/datasources/
|
+-- data/                              # runtime state (benchmark, meta-learner)
+-- Makefile
+-- pyproject.toml
+-- docker-compose.yml
+-- .env.example
+-- README.md
```

---

## API keys

| Service | Free | Where |
|---------|------|-------|
| Google Gemini | Yes | [aistudio.google.com](https://aistudio.google.com) |
| Alpha Vantage | Yes | [alphavantage.co](https://www.alphavantage.co) |
| Binance WebSocket | Yes — no key needed | — |
| Polymarket CLOB | Yes — no key needed for reads | — |
| Anthropic Claude | No | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI GPT | No | [platform.openai.com](https://platform.openai.com) |

---

## Skills demonstrated

| Skill | Where |
|-------|-------|
| Real-time streaming pipelines | Kafka, Binance WebSocket, Polymarket CLOB |
| Feature engineering | MACD, RSI, VWAP, book imbalance — computed live in Redis |
| RAG | System B agents retrieve live news, sentiment, and technicals |
| Multi-agent LLM systems | LangGraph, structured agent debate pipeline |
| ML model lifecycle | XGBoost meta-learner, MLflow tracking, Prefect retraining |
| Online learning | River updates meta-learner after every 5-minute resolution |
| Model serving | FastAPI signal service, confidence-weighted signal fusion |
| Quantitative strategy design | 9 independent strategies, each with distinct edge, entry logic, and risk controls |
| Containerisation | Docker, Docker Compose |
| Observability | Prometheus, Grafana live benchmark dashboard, MLflow logging |

---

## Roadmap

- [x] src/data/ — Binance WS + Polymarket CLOB clients
- [x] src/data/feature_pipeline.py — real-time features to Redis
- [ ] All 9 System A strategies — paper trading (v1: strategies 2 + 9)
- [ ] src/system_b/ — LangGraph agent panel with Gemini (v1: stub only)
- [x] src/system_c/ — top 10 wallet copytrade
- [x] src/signal_service/ — FastAPI with meta-learner cold start
- [x] docker-compose.yml — full local stack
- [x] Grafana benchmark dashboard
- [ ] MLflow outcome logging for all 3 systems
- [x] River online learning after each market resolution
- [ ] Prefect weekly retraining pipeline
- [ ] Next.js web frontend — public URL for resume
- [ ] Kubernetes deployment (k3s)

---

## Disclaimer

This project is for educational and research purposes only. All systems operate in simulation mode by default (`DRY_RUN=true`). Nothing in this repository constitutes financial or investment advice. Prediction markets can move to $0 or $1 instantly. Never trade with capital you cannot afford to lose.
