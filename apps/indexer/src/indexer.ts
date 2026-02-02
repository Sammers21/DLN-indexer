import { PublicKey, ConfirmedSignatureInfo, VersionedTransactionResponse } from "@solana/web3.js";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { config, createLogger, DLN_SRC_IDL, DLN_DST_IDL } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "./checkpoint";
import { Analytics, Order, OrderKind } from "./analytics";
import { SolanaClient } from "./solana";

const logger = createLogger("indexer");

function formatTime(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
}

const DLN_SRC = new PublicKey(config.dln.srcProgramId);
const DLN_DST = new PublicKey(config.dln.dstProgramId);

const srcCoder = new BorshCoder(DLN_SRC_IDL);
const dstCoder = new BorshCoder(DLN_DST_IDL);
const srcEventParser = new EventParser(DLN_SRC, srcCoder);
const dstEventParser = new EventParser(DLN_DST, dstCoder);

export class Indexer {
    private readonly solana: SolanaClient;
    private readonly checkpointStore: CheckpointStore;
    private readonly analytics: Analytics;
    private running = false;
    constructor(
        solana: SolanaClient,
        checkpointStore: CheckpointStore,
        analytics: Analytics
    ) {
        this.solana = solana;
        this.checkpointStore = checkpointStore;
        this.analytics = analytics;
    }
    async startIndexing(kind: OrderKind, checkpoint: Checkpoint | null): Promise<void> {
        const programId = kind === "OrderCreated" ? DLN_SRC : DLN_DST;
        const programType: ProgramType = kind === "OrderCreated" ? "src" : "dst";
        const eventParser = kind === "OrderCreated" ? srcEventParser : dstEventParser;
        const eventName = kind === "OrderCreated" ? "CreatedOrder" : "Fulfilled";
        let lastSignature = checkpoint?.lastSignature ?? null;
        this.running = true;
        logger.info({ kind, checkpoint }, "Starting indexing");
        while (this.running) {
            try {
                // Fetch signatures after the checkpoint (newest first)
                const signatures = await this.fetchSignatures(programId, lastSignature, config.indexer.batchSize);
                if (signatures.length === 0) {
                    logger.debug({ kind }, "No new signatures, waiting...");
                    await this.sleep(config.indexer.delayMs);
                    continue;
                }
                // Process in chronological order (oldest first)
                const chronological = signatures.reverse();
                const validSigs = chronological.filter((s) => !s.err);
                if (validSigs.length === 0) {
                    await this.sleep(config.indexer.delayMs);
                    continue;
                }
                // Fetch and parse transactions (rate-limited by SolanaClient)
                const allOrders: Order[] = [];
                let latestSigInfo: ConfirmedSignatureInfo | null = null;
                for (const sigInfo of validSigs) {
                    const tx = await this.solana.getTransaction(sigInfo.signature);
                    if (!tx) continue;
                    const orders = this.parseTransactionLogs(tx, sigInfo, eventParser, eventName, kind);
                    allOrders.push(...orders);
                    latestSigInfo = sigInfo;
                }
                // Batch insert all orders
                if (allOrders.length > 0) {
                    await this.analytics.insertOrders(allOrders);
                    for (const order of allOrders) {
                        logger.info({
                            signature: order.signature,
                            orderId: order.orderId,
                            kind,
                            usdValue: order.usdValue,
                            time: formatTime(order.time),
                        }, "Order indexed");
                    }
                }
                // Update checkpoint to the last processed signature
                if (latestSigInfo) {
                    lastSignature = latestSigInfo.signature;
                    const checkpointTime = latestSigInfo.blockTime ?? Math.floor(Date.now() / 1000);
                    await this.checkpointStore.setCheckpoint(programType, {
                        lastSignature: latestSigInfo.signature,
                        blockTime: checkpointTime,
                    });
                    logger.info({
                        kind,
                        processed: allOrders.length,
                        checkpointSignature: latestSigInfo.signature,
                        checkpointTime: formatTime(checkpointTime),
                    }, "Batch processed, checkpoint saved");
                } else {
                    logger.info({ kind, processed: 0 }, "Batch processed, no new orders");
                }
                await this.sleep(config.indexer.delayMs);
            } catch (err) {
                logger.error({ err, kind }, "Error during indexing, retrying...");
                await this.sleep(config.indexer.delayMs * 2);
            }
        }
    }
    stop(): void {
        this.running = false;
        logger.info("Indexer stopping");
    }
    private async fetchSignatures(
        programId: PublicKey,
        untilSignature: string | null,
        limit: number
    ): Promise<ConfirmedSignatureInfo[]> {
        const options: { limit?: number; until?: string } = { limit };
        if (untilSignature) {
            options.until = untilSignature;
        }
        return this.solana.getSignaturesForAddress(programId, options);
    }
    private parseTransactionLogs(
        tx: VersionedTransactionResponse,
        sigInfo: ConfirmedSignatureInfo,
        eventParser: EventParser,
        eventName: string,
        kind: OrderKind
    ): Order[] {
        const orders: Order[] = [];
        if (!tx.meta?.logMessages) return orders;
        try {
            const events = eventParser.parseLogs(tx.meta.logMessages);
            for (const event of events) {
                if (event.name === eventName) {
                    const data = event.data as { orderId: number[] };
                    const orderId = Buffer.from(data.orderId).toString("hex");
                    orders.push({
                        orderId,
                        signature: sigInfo.signature,
                        time: sigInfo.blockTime ?? Math.floor(Date.now() / 1000),
                        usdValue: 0, // TODO: calculate USD value
                        kind,
                    });
                }
            }
        } catch (err) {
            logger.debug({ err, signature: sigInfo.signature }, "Failed to parse transaction logs");
        }
        return orders;
    }
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
