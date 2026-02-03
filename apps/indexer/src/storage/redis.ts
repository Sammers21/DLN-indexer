import IORedis from "ioredis";
import { config, createLogger } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "../checkpoint";

const logger = createLogger("redis");

const CHECKPOINT_PREFIX = "indexer:checkpoint:";
const PRICE_PREFIX = "price:";
const DECIMALS_PREFIX = "decimals:";
const PRICE_TTL_SECONDS = 600; // 10 minutes

function formatBlockTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export class Redis implements CheckpointStore {
  private readonly client: IORedis; // db 0 - checkpoints
  private readonly priceClient: IORedis; // db 1 - prices
  constructor(url?: string) {
    const redisUrl = url ?? config.redis.url;
    this.client = new IORedis(redisUrl);
    this.client.on("connect", () =>
      logger.info("Redis db 0 (checkpoints) connected"),
    );
    this.client.on("error", (err) => logger.error({ err }, "Redis db 0 error"));
    // Price client on db 1
    this.priceClient = new IORedis(redisUrl, { db: 1 });
    this.priceClient.on("connect", () =>
      logger.info("Redis db 1 (prices) connected"),
    );
    this.priceClient.on("error", (err) =>
      logger.error({ err }, "Redis db 1 error"),
    );
  }
  async getCheckpoint(program: ProgramType): Promise<Checkpoint | null> {
    const data = await this.client.get(`${CHECKPOINT_PREFIX}${program}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as Checkpoint;
    } catch {
      return null;
    }
  }
  async setCheckpoint(
    program: ProgramType,
    checkpoint: Checkpoint,
  ): Promise<void> {
    const data = {
      from: {
        ...checkpoint.from,
        blockTimeFormatted: formatBlockTime(checkpoint.from.blockTime),
      },
      to: {
        ...checkpoint.to,
        blockTimeFormatted: formatBlockTime(checkpoint.to.blockTime),
      },
    };
    await this.client.set(
      `${CHECKPOINT_PREFIX}${program}`,
      JSON.stringify(data),
    );
    logger.debug({ program, checkpoint: data }, "Checkpoint saved");
  }
  async close(): Promise<void> {
    await Promise.all([this.client.quit(), this.priceClient.quit()]);
    logger.info("Redis closed");
  }
  // Price caching methods (db 1)
  async getCachedPrice(tokenKey: string): Promise<number | null> {
    const data = await this.priceClient.get(`${PRICE_PREFIX}${tokenKey}`);
    if (!data) return null;
    try {
      const price = parseFloat(data);
      logger.debug({ tokenKey, price }, "Price cache hit");
      return price;
    } catch {
      return null;
    }
  }
  async setCachedPrice(tokenKey: string, price: number): Promise<void> {
    await this.priceClient.setex(
      `${PRICE_PREFIX}${tokenKey}`,
      PRICE_TTL_SECONDS,
      price.toString(),
    );
    logger.debug({ tokenKey, price, ttl: PRICE_TTL_SECONDS }, "Price cached");
  }
  async getCachedDecimals(tokenKey: string): Promise<number | null> {
    const data = await this.priceClient.get(`${DECIMALS_PREFIX}${tokenKey}`);
    if (!data) return null;
    const decimals = Number.parseInt(data, 10);
    if (!Number.isInteger(decimals)) return null;
    logger.debug({ tokenKey, decimals }, "Decimals cache hit");
    return decimals;
  }
  async setCachedDecimals(tokenKey: string, decimals: number): Promise<void> {
    await this.priceClient.set(
      `${DECIMALS_PREFIX}${tokenKey}`,
      decimals.toString(),
    );
    logger.debug({ tokenKey, decimals }, "Decimals cached");
  }
}
