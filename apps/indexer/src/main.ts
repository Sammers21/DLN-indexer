import http from "node:http";
import { config, createLogger, Clickhouse } from "@dln/shared";
import { Indexer } from "./indexer";
import { SolanaClient } from "./solana";
import { Redis } from "./storage";
import { setPriceCache } from "./price";
import { registry } from "./metrics";

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
  async function shutdown(code: number): Promise<void> {
    srcIndexer.stop();
    dstIndexer.stop();
    await Promise.all([clickhouse.close(), redis.close()]);
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
