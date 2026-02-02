import { Connection } from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";
import { CheckpointStore, RedisCheckpointStore } from "./checkpoint";
import { Analytics, ClickHouseAnalytics } from "./analytics";
import { Indexer } from "./indexer";

const logger = createLogger("indexer");



async function main(): Promise<void> {
  logger.info({ rpcUrl: config.solana.rpcUrl }, "DLN Indexer starting");
  const connection = new Connection(config.solana.rpcUrl, {
    commitment: "confirmed",
  });
  const checkpointStore: CheckpointStore = new RedisCheckpointStore(config.redis.url);
  const analytics: Analytics = new ClickHouseAnalytics(config.clickhouse.host);
  const indexer = new Indexer(connection, checkpointStore, analytics);
  async function shutdown(code: number): Promise<void> {
    indexer.stop();
    await Promise.all([analytics.close(), checkpointStore.close()]);
    process.exit(code);
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  try {
    const [srcCheckpoint, dstCheckpoint] = await Promise.all([
      checkpointStore.getCheckpoint("src"),
      checkpointStore.getCheckpoint("dst"),
    ]);
    // Start both indexers in parallel (they run indefinitely)
    const srcIndexing = indexer.startIndexing("OrderCreated", srcCheckpoint);
    const dstIndexing = indexer.startIndexing("OrderFulfilled", dstCheckpoint);
    // Monitor progress
    const monitor = async (): Promise<void> => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const [created, fulfilled] = await Promise.all([
          analytics.getOrderCount("OrderCreated"),
          analytics.getOrderCount("OrderFulfilled"),
        ]);
        logger.info({ created, fulfilled }, "Current order counts");
        if (created >= 25000 && fulfilled >= 25000) {
          logger.info({ created, fulfilled }, "Target reached. Stopping...");
          await shutdown(0);
        }
      }
    };
    await Promise.race([srcIndexing, dstIndexing, monitor()]);
  } catch (err) {
    logger.error({ err }, "Failed to start DLN Indexer");
    await shutdown(1);
  }
}

main();
