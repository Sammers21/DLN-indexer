import { config, createLogger } from "@dln/shared";
import { Indexer } from "./indexer";
import { SolanaClient } from "./solana";
import { Redis, Clickhouse, CompositeOrderStorage } from "./storage";

const logger = createLogger("indexer");

async function main(): Promise<void> {
  logger.info("DLN Indexer starting");
  const solana = new SolanaClient();
  // Redis: implements CheckpointStore + OrderStorage (cache with 1-day TTL)
  const redis = new Redis(config.redis.url);
  // ClickHouse: implements Analytics + OrderStorage (permanent storage)
  const clickhouse = new Clickhouse(config.clickhouse.host);
  // Composite storage: tries Redis first (fast), then ClickHouse (permanent)
  const orderStorage = new CompositeOrderStorage([redis, clickhouse]);
  // Create two indexer instances, one for each order kind
  const srcIndexer = new Indexer(solana, redis, clickhouse, orderStorage, "OrderCreated");
  const dstIndexer = new Indexer(solana, redis, clickhouse, orderStorage, "OrderFulfilled");
  async function shutdown(code: number): Promise<void> {
    srcIndexer.stop();
    dstIndexer.stop();
    await Promise.all([clickhouse.close(), redis.close()]);
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
          clickhouse.getOrderCount("OrderCreated"),
          clickhouse.getOrderCount("OrderFulfilled"),
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
