import { Connection, PublicKey } from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";
import { Redis } from "./storage/redis";
import { apiRequests } from "./metrics";

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

// Redis client for price + decimals caching
let redisClient: Redis | null = null;
let solanaConnection: Connection | null = null;
const localDecimalsCache = new Map<string, number>();
const decimalsInFlight = new Map<string, Promise<number | null>>();

/**
 * Set Redis client for price + decimals caching
 */
export function setPriceCache(redis: Redis): void {
  redisClient = redis;
  logger.info("Redis price + decimals cache enabled");
}

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSolanaConnection(): Connection {
  if (!solanaConnection) {
    solanaConnection = new Connection(config.solana.rpcUrl, {
      commitment: "confirmed",
    });
  }
  return solanaConnection;
}

/**
 * Get token price from Jupiter V3 API with Redis caching
 */
export async function getTokenPrice(mint: string): Promise<number | null> {
  // 1. Check Redis cache first
  if (redisClient) {
    const cached = await redisClient.getCachedPrice(`solana:${mint}`);
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
        if (redisClient) {
          await redisClient.setCachedPrice(`solana:${mint}`, price);
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

async function fetchTokenDecimalsFromMint(
  mint: string,
): Promise<number | null> {
  try {
    const connection = getSolanaConnection();
    const accountInfo = await connection.getAccountInfo(new PublicKey(mint), {
      commitment: "confirmed",
    });
    if (!accountInfo?.data || accountInfo.data.length < TOKEN_MINT_MIN_LENGTH) {
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
 * Get token decimals from cache or mint account
 */
export async function getTokenDecimals(mint: string): Promise<number | null> {
  const localCached = localDecimalsCache.get(mint);
  if (localCached !== undefined) return localCached;
  if (redisClient) {
    const cached = await redisClient.getCachedDecimals(`solana:${mint}`);
    if (cached !== null) {
      localDecimalsCache.set(mint, cached);
      return cached;
    }
  }
  const knownDecimals = KNOWN_DECIMALS[mint];
  if (knownDecimals !== undefined) {
    localDecimalsCache.set(mint, knownDecimals);
    if (redisClient) {
      await redisClient.setCachedDecimals(`solana:${mint}`, knownDecimals);
    }
    return knownDecimals;
  }
  const inFlight = decimalsInFlight.get(mint);
  if (inFlight) return inFlight;
  const fetchPromise = (async (): Promise<number | null> => {
    const decimals = await fetchTokenDecimalsFromMint(mint);
    if (decimals !== null) {
      localDecimalsCache.set(mint, decimals);
      if (redisClient) {
        await redisClient.setCachedDecimals(`solana:${mint}`, decimals);
      }
    }
    return decimals;
  })();
  decimalsInFlight.set(mint, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    decimalsInFlight.delete(mint);
  }
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
 * Get USD value for a token amount
 */
export async function getUsdValue(
  tokenBytes: number[],
  amountBytes: number[],
): Promise<number> {
  const mint = tokenBytesToMint(tokenBytes);
  if (!mint) return 0;
  const amount = decodeAmountBytes(amountBytes, "big");
  if (amount === BigInt(0)) return 0;
  const price = await getTokenPrice(mint);
  if (price === null) {
    logger.debug({ mint }, "No price available for token");
    return 0;
  }
  const decimals = await getTokenDecimals(mint);
  if (decimals === null) {
    logger.warn({ mint }, "No decimals available for token");
    return 0;
  }
  return calculateUsdValue(amount, decimals, price);
}
