import { config, createLogger } from "@dln/shared";
import { CheckpointStore, RedisCheckpointStore } from "./checkpoint";
import { Analytics, ClickHouseAnalytics } from "./analytics";
import { Indexer } from "./indexer";
import { SolanaClient } from "./solana";

const logger = createLogger("indexer");

async function main(): Promise<void> {
  logger.info("DLN Indexer starting");
  const solana = new SolanaClient();
  const checkpointStore: CheckpointStore = new RedisCheckpointStore(config.redis.url);
  const analytics: Analytics = new ClickHouseAnalytics(config.clickhouse.host);
  // Create two indexer instances, one for each order kind
  const srcIndexer = new Indexer(solana, checkpointStore, analytics, "OrderCreated");
  const dstIndexer = new Indexer(solana, checkpointStore, analytics, "OrderFulfilled");
  async function shutdown(code: number): Promise<void> {
    srcIndexer.stop();
    dstIndexer.stop();
    await Promise.all([analytics.close(), checkpointStore.close()]);
    process.exit(code);
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  try {
    // Start both indexers in parallel (they run indefinitely)
    const srcIndexing = srcIndexer.startIndexing();
    const dstIndexing = dstIndexer.startIndexing();
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
