import IORedis from "ioredis";
import { config, createLogger } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "../checkpoint";

const logger = createLogger("redis");

const CHECKPOINT_PREFIX = "indexer:checkpoint:";

export class Redis implements CheckpointStore {
    private readonly client: IORedis;
    constructor(url?: string) {
        this.client = new IORedis(url ?? config.redis.url);
        this.client.on("connect", () => logger.info("Redis connected"));
        this.client.on("error", (err) => logger.error({ err }, "Redis error"));
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
        await this.client.set(`${CHECKPOINT_PREFIX}${program}`, JSON.stringify(data));
        logger.debug({ program, checkpoint: data }, "Checkpoint saved");
    }
    async close(): Promise<void> {
        await this.client.quit();
        logger.info("Redis closed");
    }
}
