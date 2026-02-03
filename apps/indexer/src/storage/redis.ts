import IORedis from "ioredis";
import { config, createLogger } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "../checkpoint";
import { Order } from "../analytics";
import { OrderStorage } from "./storage";

const logger = createLogger("redis");

const CHECKPOINT_PREFIX = "indexer:checkpoint:";
const CHECKPOINT_DB = 0;
const ORDER_PREFIX = "order:";
const ORDER_DB = 1;
const ORDER_TTL_SECONDS = 24 * 60 * 60; // 1 day

export class Redis implements CheckpointStore, OrderStorage {
    private readonly checkpointClient: IORedis;
    private readonly orderClient: IORedis;
    constructor(url?: string) {
        const redisUrl = url ?? config.redis.url;
        this.checkpointClient = new IORedis(redisUrl, { db: CHECKPOINT_DB });
        this.checkpointClient.on("connect", () => logger.info({ db: CHECKPOINT_DB }, "Redis checkpoint client connected"));
        this.checkpointClient.on("error", (err) => logger.error({ err, db: CHECKPOINT_DB }, "Redis checkpoint error"));
        this.orderClient = new IORedis(redisUrl, { db: ORDER_DB });
        this.orderClient.on("connect", () => logger.info({ db: ORDER_DB }, "Redis order client connected"));
        this.orderClient.on("error", (err) => logger.error({ err, db: ORDER_DB }, "Redis order error"));
    }
    // CheckpointStore implementation
    async getCheckpoint(program: ProgramType): Promise<Checkpoint | null> {
        const data = await this.checkpointClient.get(`${CHECKPOINT_PREFIX}${program}`);
        if (!data) return null;
        try {
            return JSON.parse(data) as Checkpoint;
        } catch {
            return null;
        }
    }
    async setCheckpoint(program: ProgramType, checkpoint: Checkpoint): Promise<void> {
        const data = {
            ...checkpoint,
            blockTimeFormatted: new Date(checkpoint.blockTime * 1000).toLocaleString("en-US", {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            }),
        };
        await this.checkpointClient.set(`${CHECKPOINT_PREFIX}${program}`, JSON.stringify(data));
        logger.debug({ program, checkpoint: data }, "Checkpoint saved");
    }
    // OrderStorage implementation
    async findOrderById(orderId: string): Promise<Order | null> {
        const data = await this.orderClient.get(`${ORDER_PREFIX}${orderId}`);
        if (!data) return null;
        try {
            const order = JSON.parse(data) as Order;
            logger.debug({ orderId }, "Order found in Redis cache");
            return order;
        } catch (err) {
            logger.warn({ err, orderId }, "Failed to parse cached order");
            return null;
        }
    }
    async saveOrder(order: Order): Promise<void> {
        const data = JSON.stringify(order);
        await this.orderClient.setex(`${ORDER_PREFIX}${order.orderId}`, ORDER_TTL_SECONDS, data);
        logger.debug({ orderId: order.orderId }, "Order saved to Redis cache");
    }
    async close(): Promise<void> {
        await Promise.all([this.checkpointClient.quit(), this.orderClient.quit()]);
        logger.info("Redis closed");
    }
}
