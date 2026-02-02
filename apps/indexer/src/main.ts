import { Connection } from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";
import { RedisCheckpointStore } from "./redis";
import { CheckpointStore } from "./checkpoint";
import { Analytics } from "./analytics";
import { ClickHouseAnalytics } from "./clickhouse";
import { Indexer } from "./indexer";

const logger = createLogger("indexer");



async function main(): Promise<void> {
  let checkpointStore: CheckpointStore;
  let analytics: Analytics;
  let connection: Connection;
  async function stop(code: number) {
    await Promise.all([
      analytics.close(),
      checkpointStore.close(),
    ]);
    process.exit(code);
  }
  try {
    logger.info({ rpcUrl: config.solana.rpcUrl }, "DLN Indexer starting");
    connection = new Connection(config.solana.rpcUrl, {
      commitment: "confirmed",
    });
    checkpointStore = new RedisCheckpointStore(config.redis.url);
    analytics = new ClickHouseAnalytics(config.clickhouse.host);
    const indexer = new Indexer(connection, checkpointStore, analytics);
    const [srcCheckpoint, dstCheckpoint] = await Promise.all([
      checkpointStore.getCheckpoint("src"),
      checkpointStore.getCheckpoint("dst"),
    ]);

    // start indexing
    indexer.startIndexing("OrderCreated", srcCheckpoint);
    indexer.startIndexing("OrderFulfilled", dstCheckpoint);

    // while indexing is running, check if we have reached the target event counts
    while (true) {
      const [created, fulfilled] = await Promise.all([
        analytics.getOrderCount("OrderCreated"),
        analytics.getOrderCount("OrderFulfilled"),
      ]);
      if (created >= 25000 && fulfilled >= 25000) {
        logger.info({ created, fulfilled }, "DLN Indexer has reached the target event counts. Stopping...");
        await stop(0);
      }
      // Sleep for 10 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  } catch (err) {
    logger.error({ err }, "Failed to start DLN Indexer");
    await stop(1);
  }
}

main();
