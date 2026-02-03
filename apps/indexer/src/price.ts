import { PublicKey } from "@solana/web3.js";
import { createLogger } from "@dln/shared";

const logger = createLogger("price");

const JUPITER_PRICE_API = "https://price.jup.ag/v6/price";

// Known Solana token mints and their decimals
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; isStablecoin?: boolean }> = {
    // USDC on Solana
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
        symbol: "USDC",
        decimals: 6,
        isStablecoin: true,
    },
    // USDT on Solana
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
        symbol: "USDT",
        decimals: 6,
        isStablecoin: true,
    },
    // SOL (wrapped)
    So11111111111111111111111111111111111111112: {
        symbol: "SOL",
        decimals: 9,
    },
    // BONK
    DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
        symbol: "BONK",
        decimals: 5,
    },
    // JUP
    JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
        symbol: "JUP",
        decimals: 6,
    },
};

// Simple in-memory cache for prices (TTL: 60 seconds)
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Convert token address bytes to Solana public key string (base58)
 */
export function tokenBytesToMint(tokenBytes: number[]): string | null {
    try {
        // For Solana, token address is 32 bytes
        if (tokenBytes.length !== 32) {
            logger.debug({ length: tokenBytes.length }, "Token address is not 32 bytes");
            return null;
        }
        const pubkey = new PublicKey(Uint8Array.from(tokenBytes));
        return pubkey.toBase58();
    } catch (err) {
        logger.debug({ err }, "Failed to convert token bytes to mint");
        return null;
    }
}

/**
 * Get token decimals (defaults to 6 if unknown)
 */
export function getTokenDecimals(mint: string): number {
    return KNOWN_TOKENS[mint]?.decimals ?? 6;
}

/**
 * Check if token is a stablecoin
 */
export function isStablecoin(mint: string): boolean {
    return KNOWN_TOKENS[mint]?.isStablecoin === true;
}

/**
 * Fetch token price from Jupiter API
 */
async function fetchJupiterPrice(mint: string): Promise<number | null> {
    try {
        const response = await fetch(`${JUPITER_PRICE_API}?ids=${mint}`);
        if (!response.ok) {
            logger.warn({ status: response.status, mint }, "Jupiter API error");
            return null;
        }
        const data = (await response.json()) as {
            data: Record<string, { price: number }>;
        };
        return data.data?.[mint]?.price ?? null;
    } catch (err) {
        logger.warn({ err, mint }, "Failed to fetch Jupiter price");
        return null;
    }
}

/**
 * Get token price in USD (with caching)
 */
export async function getTokenPrice(mint: string): Promise<number | null> {
    // Check cache first
    const cached = priceCache.get(mint);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.price;
    }
    // Stablecoins are always $1
    if (isStablecoin(mint)) {
        priceCache.set(mint, { price: 1.0, timestamp: Date.now() });
        return 1.0;
    }
    // Fetch from Jupiter
    const price = await fetchJupiterPrice(mint);
    if (price !== null) {
        priceCache.set(mint, { price, timestamp: Date.now() });
        logger.debug({ mint, price }, "Fetched token price");
    }
    return price;
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
    // Convert token address to mint string
    const mint = tokenBytesToMint(tokenBytes);
    if (!mint) {
        return 0;
    }
    // Convert amount bytes to bigint (big-endian)
    let amount = BigInt(0);
    for (const byte of amountBytes) {
        amount = (amount << BigInt(8)) + BigInt(byte);
    }
    if (amount === BigInt(0)) {
        return 0;
    }
    // Get price
    const price = await getTokenPrice(mint);
    if (price === null) {
        logger.debug({ mint }, "No price available for token");
        return 0;
    }
    // Calculate USD value
    const decimals = getTokenDecimals(mint);
    const usdValue = calculateUsdValue(amount, decimals, price);
    logger.debug({ mint, amount: amount.toString(), decimals, price, usdValue }, "Calculated USD value");
    return usdValue;
}
