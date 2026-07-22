import { paperEngine, PaperTrade } from "../worker/paperTrading";
import { getCurrentMarket } from "../polymarket/wsClient";
import { strategies } from "../strategies";

// Copy trading: mirrors one strategy's paper trades onto a REAL Polymarket
// account with REAL money, via the official CLOB client.
//
// Credentials come from .env only (never from the browser):
//   POLYMARKET_PRIVATE_KEY     -- exported from Polymarket: profile -> settings
//                                 -> Export private key (or your own wallet key)
//   POLYMARKET_FUNDER_ADDRESS  -- your Polymarket deposit/profile address
//                                 (the one that holds your USDC)
//   POLYMARKET_SIGNATURE_TYPE  -- 1 = email/Magic login (default),
//                                 2 = browser-wallet login, 0 = raw EOA
//
// Even with credentials present, copying stays OFF until it's switched on
// from the dashboard (or COPY_TRADING_ENABLED=true). Buys are market orders
// for COPY_STAKE_USD dollars; sells close whatever the copier bought. Wins
// and losses settle on-chain automatically when the market resolves.

const CLOB_HOST = "https://clob.polymarket.com";
const ORDER_LOG_LIMIT = 40;
const MIN_STAKE_USD = 1;
const MAX_STAKE_USD = 500;

export interface CopyOrderLog {
  timestamp: number;
  action: "BUY" | "SELL";
  side: "UP" | "DOWN";
  detail: string;
  status: "ok" | "error";
}

export interface CopyStatus {
  available: boolean; // credentials present in .env
  enabled: boolean;
  strategyId: string;
  strategyName: string;
  stakeUsd: number;
  address: string | null;
  orders: CopyOrderLog[];
  lastError: string | null;
}

interface RealPosition {
  tokenId: string;
  side: "UP" | "DOWN";
  shares: number;
}

function envCreds() {
  const privateKey = process.env.POLYMARKET_PRIVATE_KEY?.trim();
  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
  if (!privateKey || !funder) return null;
  return {
    privateKey: (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`,
    funder,
    signatureType: Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "1"),
  };
}

class CopyTrader {
  private enabled = process.env.COPY_TRADING_ENABLED === "true";
  private strategyId = process.env.COPY_STRATEGY_ID ?? strategies[0].id;
  private stakeUsd = Number(process.env.COPY_STAKE_USD ?? "5");
  private client: any = null;
  private clientPromise: Promise<any> | null = null;
  private address: string | null = null;
  private orders: CopyOrderLog[] = [];
  private positions: RealPosition[] = [];
  private lastError: string | null = null;

  constructor() {
    paperEngine.on("trade", (trade: PaperTrade) => {
      this.onPaperTrade(trade).catch((err) => {
        this.lastError = String(err?.message ?? err);
        console.error("[copy] trade mirror failed", err);
      });
    });
  }

  // -- config -----------------------------------------------------------------

  getStatus(): CopyStatus {
    const strategy = strategies.find((s) => s.id === this.strategyId) ?? strategies[0];
    return {
      available: envCreds() !== null,
      enabled: this.enabled && envCreds() !== null,
      strategyId: strategy.id,
      strategyName: strategy.name,
      stakeUsd: this.stakeUsd,
      address: this.address,
      orders: this.orders.slice(0, ORDER_LOG_LIMIT),
      lastError: this.lastError,
    };
  }

  setConfig(config: { enabled?: boolean; strategyId?: string; stakeUsd?: number }) {
    if (config.strategyId && strategies.some((s) => s.id === config.strategyId)) {
      this.strategyId = config.strategyId;
    }
    if (config.stakeUsd !== undefined && Number.isFinite(config.stakeUsd)) {
      this.stakeUsd = Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, config.stakeUsd));
    }
    if (config.enabled !== undefined) {
      this.enabled = config.enabled && envCreds() !== null;
      if (config.enabled && envCreds() === null) {
        this.lastError =
          "Add POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS to .env, then restart.";
      }
    }
    return this.getStatus();
  }

  // -- CLOB client (lazy, created on first real order) --------------------------

  private async getClient() {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    const creds = envCreds();
    if (!creds) throw new Error("Polymarket credentials missing from .env");

    this.clientPromise = (async () => {
      const [{ ClobClient, Chain }, { createWalletClient, http }, { privateKeyToAccount }, { polygon }] =
        await Promise.all([
          import("@polymarket/clob-client"),
          import("viem"),
          import("viem/accounts"),
          import("viem/chains"),
        ]);

      const account = privateKeyToAccount(creds.privateKey);
      this.address = account.address;

      const wallet = createWalletClient({
        account,
        chain: polygon,
        transport: http("https://polygon-rpc.com"),
      });

      const bootstrap = new ClobClient(
        CLOB_HOST,
        Chain.POLYGON,
        wallet,
        undefined,
        creds.signatureType,
        creds.funder
      );
      const apiCreds = await bootstrap.createOrDeriveApiKey();

      this.client = new ClobClient(
        CLOB_HOST,
        Chain.POLYGON,
        wallet,
        apiCreds,
        creds.signatureType,
        creds.funder
      );
      console.log(`[copy] connected to Polymarket as ${account.address}`);
      return this.client;
    })().finally(() => {
      this.clientPromise = null;
    });

    return this.clientPromise;
  }

  // -- mirroring ----------------------------------------------------------------

  private log(entry: CopyOrderLog) {
    this.orders.unshift(entry);
    if (this.orders.length > ORDER_LOG_LIMIT) this.orders.pop();
  }

  private async onPaperTrade(trade: PaperTrade) {
    if (!this.enabled || trade.strategyId !== this.strategyId) return;
    // WIN/LOSS are window resolutions -- real positions settle on-chain.
    if (trade.action !== "BUY" && trade.action !== "SELL") {
      this.positions = [];
      return;
    }

    const market = getCurrentMarket();
    if (!market || market.conditionId !== trade.conditionId) return;

    const tokenId = trade.side === "UP" ? market.upTokenId : market.downTokenId;
    const client = await this.getClient();
    const { Side, OrderType } = await import("@polymarket/clob-client");

    if (trade.action === "BUY") {
      const order = await client.createMarketOrder({
        tokenID: tokenId,
        amount: this.stakeUsd,
        side: Side.BUY,
      });
      const res = await client.postOrder(order, OrderType.FOK);
      const ok = res?.success !== false;
      const estShares = this.stakeUsd / Math.max(trade.price, 0.01);
      if (ok) this.positions.push({ tokenId, side: trade.side, shares: estShares });
      this.lastError = ok ? null : JSON.stringify(res?.errorMsg ?? res);
      this.log({
        timestamp: Date.now(),
        action: "BUY",
        side: trade.side,
        detail: ok
          ? `bought ~$${this.stakeUsd.toFixed(2)} of ${trade.side} @ ~${(trade.price * 100).toFixed(1)}¢ (copying ${trade.strategyName})`
          : `buy rejected: ${this.lastError}`,
        status: ok ? "ok" : "error",
      });
      return;
    }

    // SELL: close everything we bought on that side.
    const held = this.positions.filter((p) => p.tokenId === tokenId);
    if (held.length === 0) return;
    const shares = held.reduce((sum, p) => sum + p.shares, 0);

    const order = await client.createMarketOrder({
      tokenID: tokenId,
      amount: Math.floor(shares * 100) / 100,
      side: Side.SELL,
    });
    const res = await client.postOrder(order, OrderType.FOK);
    const ok = res?.success !== false;
    if (ok) this.positions = this.positions.filter((p) => p.tokenId !== tokenId);
    this.lastError = ok ? null : JSON.stringify(res?.errorMsg ?? res);
    this.log({
      timestamp: Date.now(),
      action: "SELL",
      side: trade.side,
      detail: ok
        ? `sold ~${shares.toFixed(2)} ${trade.side} shares @ ~${(trade.price * 100).toFixed(1)}¢ (copying ${trade.strategyName})`
        : `sell rejected: ${this.lastError}`,
      status: ok ? "ok" : "error",
    });
  }
}

// Process-wide singleton on globalThis so separate route bundles (and dev
// hot reloads) never double-subscribe and never place duplicate real orders.
const globalForCopy = globalThis as unknown as { pmCopyTrader?: CopyTrader };
export const copyTrader = globalForCopy.pmCopyTrader ?? new CopyTrader();
globalForCopy.pmCopyTrader = copyTrader;
