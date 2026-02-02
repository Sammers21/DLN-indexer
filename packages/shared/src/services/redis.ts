import Redis from 'ioredis';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type { IndexerCheckpoint } from '../types.js';

const logger = createLogger('redis');

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(config.redis.url);
    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error({ err }, 'Redis error'));
  }
  return redis;
}

export async function closeRedisClient(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis client closed');
  }
}

const CHECKPOINT_PREFIX = 'indexer:checkpoint:';

export async function getCheckpoint(program: 'src' | 'dst'): Promise<IndexerCheckpoint | null> {
  const r = getRedisClient();
  const data = await r.get(`${CHECKPOINT_PREFIX}${program}`);
  if (!data) return null;
  try {
    return JSON.parse(data) as IndexerCheckpoint;
  } catch {
    return null;
  }
}

export async function setCheckpoint(checkpoint: IndexerCheckpoint): Promise<void> {
  const r = getRedisClient();
  await r.set(
    `${CHECKPOINT_PREFIX}${checkpoint.program}`,
    JSON.stringify({
      ...checkpoint,
      updated_at: new Date().toISOString(),
    })
  );
  logger.debug({ checkpoint }, 'Checkpoint saved');
}

const PRICE_PREFIX = 'price:';
const PRICE_TTL = 300;

export async function getCachedPrice(tokenAddress: string): Promise<number | null> {
  const r = getRedisClient();
  const data = await r.get(`${PRICE_PREFIX}${tokenAddress}`);
  if (!data) return null;
  return parseFloat(data);
}

export async function setCachedPrice(tokenAddress: string, priceUsd: number): Promise<void> {
  const r = getRedisClient();
  await r.setex(`${PRICE_PREFIX}${tokenAddress}`, PRICE_TTL, priceUsd.toString());
}

export async function getCachedPrices(
  tokenAddresses: string[]
): Promise<Map<string, number | null>> {
  const r = getRedisClient();
  const keys = tokenAddresses.map((addr) => `${PRICE_PREFIX}${addr}`);
  const values = await r.mget(...keys);
  const result = new Map<string, number | null>();
  tokenAddresses.forEach((addr, i) => {
    const val = values[i];
    result.set(addr, val ? parseFloat(val) : null);
  });
  return result;
}

export async function setCachedPrices(prices: Map<string, number>): Promise<void> {
  const r = getRedisClient();
  const pipeline = r.pipeline();
  for (const [addr, price] of prices) {
    pipeline.setex(`${PRICE_PREFIX}${addr}`, PRICE_TTL, price.toString());
  }
  await pipeline.exec();
}
