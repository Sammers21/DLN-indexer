import http from "node:http";
import { config, createLogger, Clickhouse } from "@dln/shared";
import { Indexer } from "./indexer.js";
import { SolanaClient } from "./solana.js";
import { Redis } from "./storage/index.js";
import { setPriceCache } from "./price.js";
import { registry } from "./metrics.js";

const logger = createLogger("indexer");

async function main(): Promise<void> {
  logger.info("DLN Indexer starting");
  const solana = new SolanaClient();
  const redis = new Redis(config.redis.url);
  const clickhouse = new Clickhouse(config.clickhouse.host);
  // Enable Redis price caching (10 min TTL)
  setPriceCache(redis);
  const srcIndexer = new Indexer(solana, redis, clickhouse, "OrderCreated");
  const dstIndexer = new Indexer(solana, redis, clickhouse, "OrderFulfilled");

  // Track indexing promises for graceful shutdown
  let srcIndexingPromise: Promise<void> | null = null;
  let dstIndexingPromise: Promise<void> | null = null;
  let isShuttingDown = false;

  async function shutdown(code: number): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("Initiating graceful shutdown...");

    // Signal indexers to stop
    await Promise.all([srcIndexer.stop(), dstIndexer.stop()]);

    // Wait for in-flight indexing operations to complete
    if (srcIndexingPromise || dstIndexingPromise) {
      logger.info("Waiting for in-flight indexing operations to complete...");
      await Promise.allSettled(
        [srcIndexingPromise, dstIndexingPromise].filter(Boolean),
      );
    }

    // Close connections
    await Promise.all([clickhouse.close(), redis.close()]);
    logger.info("Shutdown complete");
    process.exit(code);
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  // Expose Prometheus metrics on port 9090
  const metricsPort = Number(process.env.METRICS_PORT ?? 9090);
  const metricsServer = http.createServer(async (_req, res) => {
    if (_req.url === "/metrics") {
      const metrics = await registry.metrics();
      res.writeHead(200, { "Content-Type": registry.contentType });
      res.end(metrics);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
  metricsServer.listen(metricsPort);
  logger.info({ port: metricsPort }, "Indexer metrics server started");
  try {
    srcIndexingPromise = srcIndexer.startIndexing();
    dstIndexingPromise = dstIndexer.startIndexing();
    // Monitor progress
    const monitor = async (): Promise<void> => {
      while (!isShuttingDown) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        if (isShuttingDown) break;
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
    await Promise.race([srcIndexingPromise, dstIndexingPromise, monitor()]);
  } catch (err) {
    logger.error({ err }, "Failed to start DLN Indexer");
    await shutdown(1);
  }
}

main();
