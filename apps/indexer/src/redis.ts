import Redis from "ioredis";
import { config, createLogger } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "./checkpoint";

const logger = createLogger("redis");

export class RedisCheckpointStore implements CheckpointStore {
    private readonly redis: Redis;
    private readonly prefix = "indexer:checkpoint:";
    constructor(url: string) {
        this.redis = new Redis(url);
        this.redis.on("connect", () => logger.info("Redis connected"));
        this.redis.on("error", (err) => logger.error({ err }, "Redis error"));
    }
    async getCheckpoint(program: ProgramType): Promise<Checkpoint | null> {
        const data = await this.redis.get(`${this.prefix}${program}`);
        if (!data) return null;
        try {
            return JSON.parse(data) as Checkpoint;
        } catch {
            return null;
        }
    }
    async setCheckpoint(program: ProgramType, checkpoint: Checkpoint): Promise<void> {
        await this.redis.set(`${this.prefix}${program}`, JSON.stringify(checkpoint));
        logger.debug({ program, checkpoint }, "Checkpoint saved");
    }
    async close(): Promise<void> {
        await this.redis.quit();
        logger.info("Redis closed");
    }
}
