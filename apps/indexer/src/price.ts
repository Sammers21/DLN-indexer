import { PublicKey } from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";
import { Redis } from "./storage/redis";

const logger = createLogger("price");

// Jupiter Price API V3 (requires API key from https://portal.jup.ag)
const JUPITER_API = "https://api.jup.ag/price/v3";

// Redis client for price caching
let redisClient: Redis | null = null;

/**
 * Set Redis client for price caching (10 min TTL)
 */
export function setPriceCache(redis: Redis): void {
    redisClient = redis;
    logger.info("Redis price cache enabled");
}

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
                logger.debug({ mint, attempt, delay }, "Jupiter rate limited, retrying...");
                await sleep(delay);
                continue;
            }
            if (!response.ok) {
                logger.warn({ status: response.status, mint }, "Jupiter API error");
                return null;
            }
            const data = (await response.json()) as Record<string, { usdPrice?: number }>;
            const usdPrice = data[mint]?.usdPrice;
            if (usdPrice !== undefined) {
                const price = usdPrice;
                // Cache in Redis
                if (redisClient) {
                    await redisClient.setCachedPrice(`solana:${mint}`, price);
                }
                logger.debug({ mint, price }, "Fetched token price from Jupiter");
                return price;
            }
            return null;
        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRIES - 1) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
                logger.debug({ mint, attempt, delay }, "Jupiter fetch failed, retrying...");
                await sleep(delay);
            }
        }
    }
    logger.debug({ err: lastError, mint }, "Failed to fetch Jupiter price after retries");
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
 * Get token decimals (defaults to 6 if unknown)
 */
export function getTokenDecimals(mint: string): number {
    const KNOWN_DECIMALS: Record<string, number> = {
        So11111111111111111111111111111111111111112: 9,  // SOL
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,  // USDC
        Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,  // USDT
        DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 5,  // BONK
        JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 6,   // JUP
    };
    return KNOWN_DECIMALS[mint] ?? 6;
}

/**
 * Calculate USD value from raw amount
 */
export function calculateUsdValue(amount: bigint, decimals: number, priceUsd: number): number {
    if (amount === BigInt(0)) return 0;
    const divisor = BigInt(10 ** decimals);
    const wholeUnits = Number(amount / divisor);
    const fractionalUnits = Number(amount % divisor) / Number(divisor);
    return (wholeUnits + fractionalUnits) * priceUsd;
}

/**
 * Get USD value for a token amount
 */
export async function getUsdValue(tokenBytes: number[], amountBytes: number[]): Promise<number> {
    const mint = tokenBytesToMint(tokenBytes);
    if (!mint) return 0;
    // Convert amount bytes to bigint (big-endian)
    let amount = BigInt(0);
    for (const byte of amountBytes) {
        amount = (amount << BigInt(8)) + BigInt(byte);
    }
    if (amount === BigInt(0)) return 0;
    const price = await getTokenPrice(mint);
    if (price === null) {
        logger.debug({ mint }, "No price available for token");
        return 0;
    }
    const decimals = getTokenDecimals(mint);
    return calculateUsdValue(amount, decimals, price);
}
