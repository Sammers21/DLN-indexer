import { Connection, PublicKey } from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";
import { Redis } from "./storage/redis.js";
import { apiRequests } from "./metrics.js";

const logger = createLogger("price");

// Jupiter Price API V3 (requires API key from https://portal.jup.ag)
const JUPITER_API = "https://api.jup.ag/price/v3";
const TOKEN_MINT_DECIMALS_OFFSET = 44;
const TOKEN_MINT_MIN_LENGTH = 45;
const KNOWN_DECIMALS: Record<string, number> = {
  So11111111111111111111111111111111111111112: 9, // SOL
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 5, // BONK
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 6, // JUP
};

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PriceService encapsulates all state for price fetching and caching.
 * This avoids global mutable state and makes the module testable.
 */
export class PriceService {
  private readonly redisClient: Redis | null;
  private readonly solanaConnection: Connection;
  private readonly localDecimalsCache = new Map<string, number>();
  private readonly decimalsInFlight = new Map<string, Promise<number | null>>();

  constructor(redis: Redis | null = null, connection?: Connection) {
    this.redisClient = redis;
    this.solanaConnection =
      connection ??
      new Connection(config.solana.rpcUrl, { commitment: "confirmed" });
    if (redis) {
      logger.info("PriceService initialized with Redis cache");
    }
  }

  /**
   * Get token price from Jupiter V3 API with Redis caching
   */
  async getTokenPrice(mint: string): Promise<number | null> {
    // 1. Check Redis cache first
    if (this.redisClient) {
      const cached = await this.redisClient.getCachedPrice(`solana:${mint}`);
      if (cached !== null) {
        return cached;
      }
    }
    // 2. Fetch from Jupiter
    const apiKey = config.jupiter.apiKey;
    if (!apiKey) {
      logger.warn("Jupiter API key not configured");
      return null;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${JUPITER_API}?ids=${mint}`, {
          signal: controller.signal,
          headers: { "x-api-key": apiKey },
        });
        clearTimeout(timeout);
        if (response.status === 429) {
          apiRequests.inc({
            dest: "jupiter",
            endpoint: "price",
            status: "rate_limited",
          });
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          logger.debug(
            { mint, attempt, delay },
            "Jupiter rate limited, retrying...",
          );
          await sleep(delay);
          continue;
        }
        if (!response.ok) {
          apiRequests.inc({
            dest: "jupiter",
            endpoint: "price",
            status: "error",
          });
          logger.warn({ status: response.status, mint }, "Jupiter API error");
          return null;
        }
        const data = (await response.json()) as Record<
          string,
          { usdPrice?: number }
        >;
        const usdPrice = data[mint]?.usdPrice;
        if (usdPrice !== undefined) {
          apiRequests.inc({
            dest: "jupiter",
            endpoint: "price",
            status: "success",
          });
          const price = usdPrice;
          // Cache in Redis
          if (this.redisClient) {
            await this.redisClient.setCachedPrice(`solana:${mint}`, price);
          }
          logger.debug({ mint, price }, "Fetched token price from Jupiter");
          return price;
        }
        apiRequests.inc({
          dest: "jupiter",
          endpoint: "price",
          status: "no_data",
        });
        return null;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          logger.debug(
            { mint, attempt, delay },
            "Jupiter fetch failed, retrying...",
          );
          await sleep(delay);
        }
      }
    }
    apiRequests.inc({ dest: "jupiter", endpoint: "price", status: "error" });
    logger.debug(
      { err: lastError, mint },
      "Failed to fetch Jupiter price after retries",
    );
    return null;
  }

  /**
   * Get token decimals from cache or mint account
   */
  async getTokenDecimals(mint: string): Promise<number | null> {
    const localCached = this.localDecimalsCache.get(mint);
    if (localCached !== undefined) return localCached;
    if (this.redisClient) {
      const cached = await this.redisClient.getCachedDecimals(`solana:${mint}`);
      if (cached !== null) {
        this.localDecimalsCache.set(mint, cached);
        return cached;
      }
    }
    const knownDecimals = KNOWN_DECIMALS[mint];
    if (knownDecimals !== undefined) {
      this.localDecimalsCache.set(mint, knownDecimals);
      if (this.redisClient) {
        await this.redisClient.setCachedDecimals(
          `solana:${mint}`,
          knownDecimals,
        );
      }
      return knownDecimals;
    }
    const inFlight = this.decimalsInFlight.get(mint);
    if (inFlight) return inFlight;
    const fetchPromise = (async (): Promise<number | null> => {
      const decimals = await this.fetchTokenDecimalsFromMint(mint);
      if (decimals !== null) {
        this.localDecimalsCache.set(mint, decimals);
        if (this.redisClient) {
          await this.redisClient.setCachedDecimals(`solana:${mint}`, decimals);
        }
      }
      return decimals;
    })();
    this.decimalsInFlight.set(mint, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.decimalsInFlight.delete(mint);
    }
  }

  private async fetchTokenDecimalsFromMint(
    mint: string,
  ): Promise<number | null> {
    try {
      const accountInfo = await this.solanaConnection.getAccountInfo(
        new PublicKey(mint),
        { commitment: "confirmed" },
      );
      if (
        !accountInfo?.data ||
        accountInfo.data.length < TOKEN_MINT_MIN_LENGTH
      ) {
        logger.warn({ mint }, "Mint account not found or invalid");
        return null;
      }
      const decimalsByte = accountInfo.data[TOKEN_MINT_DECIMALS_OFFSET];
      if (decimalsByte === undefined) return null;
      const decimals = Number(decimalsByte);
      if (!Number.isInteger(decimals)) return null;
      logger.debug(
        { mint, decimals },
        "Fetched token decimals from mint account",
      );
      return decimals;
    } catch (err) {
      logger.warn({ err, mint }, "Failed to fetch token decimals from mint");
      return null;
    }
  }

  /**
   * Get USD value for a token amount
   */
  async getUsdValue(
    tokenBytes: number[],
    amountBytes: number[],
  ): Promise<number> {
    const mint = tokenBytesToMint(tokenBytes);
    if (!mint) return 0;
    const amount = decodeAmountBytes(amountBytes, "big");
    if (amount === BigInt(0)) return 0;
    const price = await this.getTokenPrice(mint);
    if (price === null) {
      logger.debug({ mint }, "No price available for token");
      return 0;
    }
    const decimals = await this.getTokenDecimals(mint);
    if (decimals === null) {
      logger.warn({ mint }, "No decimals available for token");
      return 0;
    }
    return calculateUsdValue(amount, decimals, price);
  }
}

// ============================================================================
// Backward-compatible module-level API (wraps a singleton PriceService)
// These exports maintain compatibility with existing code.
// ============================================================================

let defaultPriceService: PriceService | null = null;

/**
 * Get or create the default PriceService instance (lazy initialization)
 */
function getOrCreateDefaultService(): PriceService {
  if (!defaultPriceService) {
    // Create a PriceService without Redis caching for backward compatibility
    defaultPriceService = new PriceService(null);
  }
  return defaultPriceService;
}

/**
 * Set Redis client for price + decimals caching (backward-compatible)
 */
export function setPriceCache(redis: Redis): void {
  defaultPriceService = new PriceService(redis);
  logger.info("Redis price + decimals cache enabled");
}

/**
 * Get the default PriceService instance
 */
export function getDefaultPriceService(): PriceService | null {
  return defaultPriceService;
}

/**
 * Convert token address bytes to Solana public key string (base58)
 */
export function tokenBytesToMint(tokenBytes: number[]): string | null {
  try {
    if (tokenBytes.length !== 32) {
      return null;
    }
    return new PublicKey(Uint8Array.from(tokenBytes)).toBase58();
  } catch {
    return null;
  }
}

/**
 * Decode 32-byte amount bytes into bigint
 */
export function decodeAmountBytes(
  amountBytes: number[],
  endianness: "big" | "little",
): bigint {
  let amount = BigInt(0);
  if (endianness === "big") {
    for (const byte of amountBytes) {
      amount = (amount << BigInt(8)) + BigInt(byte);
    }
    return amount;
  }
  for (let i = 0; i < amountBytes.length; i++) {
    amount = amount + (BigInt(amountBytes[i]) << (BigInt(8) * BigInt(i)));
  }
  return amount;
}

/**
 * Calculate USD value from raw amount
 */
export function calculateUsdValue(
  amount: bigint,
  decimals: number,
  priceUsd: number,
): number {
  if (amount === BigInt(0)) return 0;
  const divisor = BigInt(10) ** BigInt(decimals);
  const wholeUnits = Number(amount / divisor);
  const fractionalUnits = Number(amount % divisor) / Number(divisor);
  return (wholeUnits + fractionalUnits) * priceUsd;
}

/**
 * Get token price from Jupiter V3 API with Redis caching (backward-compatible)
 */
export async function getTokenPrice(mint: string): Promise<number | null> {
  return getOrCreateDefaultService().getTokenPrice(mint);
}

/**
 * Get token decimals from cache or mint account (backward-compatible)
 */
export async function getTokenDecimals(mint: string): Promise<number | null> {
  return getOrCreateDefaultService().getTokenDecimals(mint);
}

/**
 * Get USD value for a token amount (backward-compatible)
 */
export async function getUsdValue(
  tokenBytes: number[],
  amountBytes: number[],
): Promise<number> {
  return getOrCreateDefaultService().getUsdValue(tokenBytes, amountBytes);
}
