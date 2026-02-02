import {
  config,
  createLogger,
  getCheckpoint,
  setCheckpoint,
  closeRedisClient,
  insertOrders,
  closeClickHouseClient,
  enrichOrdersWithPrices,
  type Order,
} from "@dln/shared";
import { fetchSignatures, fetchTransactions, sleep } from "./fetcher.js";
import { parseTransaction } from "./parser.js";

const logger = createLogger("indexer");

interface IndexerStats {
  totalSignatures: number;
  totalOrders: number;
  createdOrders: number;
  fulfilledOrders: number;
  errors: number;
}

async function indexProgram(
  programId: string,
  programType: "src" | "dst",
  stats: IndexerStats,
): Promise<void> {
  logger.info({ programId, programType }, "Starting program indexing");
  let checkpoint = await getCheckpoint(programType);
  let beforeSignature: string | undefined = checkpoint?.last_signature;
  let hasMore = true;
  let batchCount = 0;
  while (hasMore) {
    try {
      const signatures = await fetchSignatures({
        programId,
        before: beforeSignature,
        limit: config.indexer.batchSize,
      });
      if (signatures.length === 0) {
        hasMore = false;
        break;
      }
      stats.totalSignatures += signatures.length;
      batchCount++;
      const signatureStrings = signatures.map((s) => s.signature);
      const transactions = await fetchTransactions(signatureStrings);
      const orders: Order[] = [];
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        if (!tx) continue;
        try {
          const parsedOrders = parseTransaction(tx);
          orders.push(...parsedOrders);
        } catch (err) {
          logger.error(
            { err, signature: signatureStrings[i] },
            "Failed to parse transaction",
          );
          stats.errors++;
        }
      }
      if (orders.length > 0) {
        const enrichedOrders = await enrichOrdersWithPrices(orders);
        await insertOrders(enrichedOrders);
        stats.totalOrders += orders.length;
        stats.createdOrders += orders.filter(
          (o) => o.event_type === "created",
        ).length;
        stats.fulfilledOrders += orders.filter(
          (o) => o.event_type === "fulfilled",
        ).length;
        logger.info(
          {
            batch: batchCount,
            signatures: signatures.length,
            orders: orders.length,
            totalOrders: stats.totalOrders,
          },
          "Processed batch",
        );
      }
      const lastSig = signatures[signatures.length - 1];
      checkpoint = {
        program: programType,
        last_signature: lastSig.signature,
        last_slot: lastSig.slot,
        updated_at: new Date().toISOString(),
      };
      await setCheckpoint(checkpoint);
      beforeSignature = lastSig.signature;
      await sleep(config.indexer.delayMs);
      if (stats.totalOrders >= 60000) {
        logger.info("Reached target order count, stopping");
        hasMore = false;
      }
    } catch (err) {
      const isRateLimit =
        (err as Error).message?.includes("429") ||
        (err as Error).message?.includes("Too many requests");
      if (isRateLimit) {
        logger.warn(
          { batch: batchCount },
          "Rate limited, waiting 30s before retry",
        );
        await sleep(30000);
      } else {
        logger.error({ err, batch: batchCount }, "Error processing batch");
        stats.errors++;
        await sleep(5000);
      }
    }
  }
  logger.info({ programType, stats }, "Program indexing complete");
}

async function main(): Promise<void> {
  logger.info("DLN Indexer starting");
  const stats: IndexerStats = {
    totalSignatures: 0,
    totalOrders: 0,
    createdOrders: 0,
    fulfilledOrders: 0,
    errors: 0,
  };
  try {
    await indexProgram(config.dln.srcProgramId, "src", stats);
    await indexProgram(config.dln.dstProgramId, "dst", stats);
    logger.info({ stats }, "Indexing complete");
  } catch (err) {
    logger.error({ err }, "Fatal error during indexing");
    process.exit(1);
  } finally {
    await closeRedisClient();
    await closeClickHouseClient();
  }
}

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down");
  await closeRedisClient();
  await closeClickHouseClient();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down");
  await closeRedisClient();
  await closeClickHouseClient();
  process.exit(0);
});

main().catch((err) => {
  logger.error({ err }, "Unhandled error");
  process.exit(1);
});
