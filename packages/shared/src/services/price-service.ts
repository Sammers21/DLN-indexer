import {
  getCachedPrice,
  setCachedPrice,
  getCachedPrices,
  setCachedPrices,
} from "./redis.js";
import { createLogger } from "../utils/logger.js";
import type { Order } from "../types.js";

const logger = createLogger("price-service");

const JUPITER_PRICE_API = "https://price.jup.ag/v6/price";

const KNOWN_TOKENS: Record<
  string,
  { symbol: string; decimals: number; isStablecoin?: boolean }
> = {
  c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61: {
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  dac17f958d2ee523a2206206994597c13d831ec7: {
    symbol: "USDT",
    decimals: 6,
    isStablecoin: true,
  },
  so11111111111111111111111111111111111111112: {
    symbol: "SOL",
    decimals: 9,
  },
};

const SOLANA_CHAIN_ID = "7565164";

async function fetchJupiterPrice(tokenMint: string): Promise<number | null> {
  try {
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${tokenMint}`);
    if (!response.ok) {
      logger.warn({ status: response.status, tokenMint }, "Jupiter API error");
      return null;
    }
    const data = (await response.json()) as {
      data: Record<string, { price: number }>;
    };
    return data.data?.[tokenMint]?.price || null;
  } catch (err) {
    logger.error({ err, tokenMint }, "Failed to fetch Jupiter price");
    return null;
  }
}

async function fetchJupiterPrices(
  tokenMints: string[],
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (tokenMints.length === 0) return prices;
  try {
    const ids = tokenMints.join(",");
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
    if (!response.ok) {
      logger.warn({ status: response.status }, "Jupiter API batch error");
      return prices;
    }
    const data = (await response.json()) as {
      data: Record<string, { price: number }>;
    };
    for (const [mint, info] of Object.entries(data.data || {})) {
      if (info?.price) {
        prices.set(mint, info.price);
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch Jupiter prices batch");
  }
  return prices;
}

export async function getTokenPrice(
  tokenAddress: string,
): Promise<number | null> {
  const cached = await getCachedPrice(tokenAddress);
  if (cached !== null) {
    return cached;
  }
  const knownToken = KNOWN_TOKENS[tokenAddress.toLowerCase()];
  if (knownToken?.isStablecoin) {
    await setCachedPrice(tokenAddress, 1.0);
    return 1.0;
  }
  const price = await fetchJupiterPrice(tokenAddress);
  if (price !== null) {
    await setCachedPrice(tokenAddress, price);
  }
  return price;
}

export async function getTokenPrices(
  tokenAddresses: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const uncached: string[] = [];
  const cached = await getCachedPrices(tokenAddresses);
  for (const [addr, price] of cached) {
    if (price !== null) {
      result.set(addr, price);
    } else {
      const knownToken = KNOWN_TOKENS[addr.toLowerCase()];
      if (knownToken?.isStablecoin) {
        result.set(addr, 1.0);
      } else {
        uncached.push(addr);
      }
    }
  }
  if (uncached.length > 0) {
    const fetched = await fetchJupiterPrices(uncached);
    for (const [addr, price] of fetched) {
      result.set(addr, price);
    }
    await setCachedPrices(fetched);
  }
  return result;
}

export function calculateUsdValue(
  amount: bigint,
  decimals: number,
  priceUsd: number,
): number {
  const divisor = BigInt(10 ** decimals);
  const wholeUnits = Number(amount / divisor);
  const fractionalUnits = Number(amount % divisor) / Number(divisor);
  return (wholeUnits + fractionalUnits) * priceUsd;
}

function getTokenDecimals(tokenAddress: string): number {
  const knownToken = KNOWN_TOKENS[tokenAddress.toLowerCase()];
  return knownToken?.decimals || 6;
}

export async function enrichOrdersWithPrices(
  orders: Order[],
): Promise<Order[]> {
  const tokenAddresses = new Set<string>();
  for (const order of orders) {
    if (order.event_type === "created" && order.give_token_address) {
      if (order.give_chain_id === SOLANA_CHAIN_ID) {
        tokenAddresses.add(order.give_token_address);
      }
    }
  }
  const prices = await getTokenPrices(Array.from(tokenAddresses));
  return orders.map((order) => {
    if (
      order.event_type === "created" &&
      order.give_token_address &&
      order.give_amount
    ) {
      const price = prices.get(order.give_token_address);
      if (price) {
        const decimals = getTokenDecimals(order.give_token_address);
        const usdValue = calculateUsdValue(order.give_amount, decimals, price);
        return { ...order, give_amount_usd: usdValue };
      }
    }
    return order;
  });
}
