import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { config, createLogger, DLN_SRC_IDL, DLN_DST_IDL } from "@dln/shared";
import { Checkpoint, CheckpointStore } from "./checkpoint";
import { Analytics, OrderKind } from "./analytics";

const logger = createLogger("indexer");

const DLN_SRC = new PublicKey(config.dln.srcProgramId);
const DLN_DST = new PublicKey(config.dln.dstProgramId);

const srcCoder = new BorshCoder(DLN_SRC_IDL);
const dstCoder = new BorshCoder(DLN_DST_IDL);
const srcEventParser = new EventParser(DLN_SRC, srcCoder);
const dstEventParser = new EventParser(DLN_DST, dstCoder);

export class Indexer {
    private readonly connection: Connection;
    private readonly checkpointStore: CheckpointStore;
    private readonly analytics: Analytics;
    constructor(
        connection: Connection,
        checkpointStore: CheckpointStore,
        analytics: Analytics
    ) {
        this.connection = connection;
        this.checkpointStore = checkpointStore;
        this.analytics = analytics;
    }
    startIndexing(kind: OrderKind, checkpoint: Checkpoint | null): void {
        if (kind === "OrderCreated") {
            this.subscribeToOrderCreated(checkpoint);
        } else {
            this.subscribeToOrderFulfilled(checkpoint);
        }
    }
    private subscribeToOrderCreated(checkpoint: Checkpoint | null): void {
        logger.info({ checkpoint }, "Subscribing to OrderCreated events");
        this.connection.onLogs(DLN_SRC, (logs) => this.handleSrcLogs(logs), "confirmed");
    }
    private subscribeToOrderFulfilled(checkpoint: Checkpoint | null): void {
        logger.info({ checkpoint }, "Subscribing to OrderFulfilled events");
        this.connection.onLogs(DLN_DST, (logs) => this.handleDstLogs(logs), "confirmed");
    }
    private async handleSrcLogs(logs: Logs): Promise<void> {
        if (logs.err) return;
        try {
            const events = srcEventParser.parseLogs(logs.logs);
            for (const event of events) {
                if (event.name === "CreatedOrder") {
                    const data = event.data as { orderId: number[] };
                    const orderId = Buffer.from(data.orderId).toString("hex");
                    const blockTime = Math.floor(Date.now() / 1000);
                    await this.analytics.insertOrder({
                        orderId,
                        signature: logs.signature,
                        time: blockTime,
                        usdValue: 0, // TODO: calculate USD value
                        kind: "OrderCreated",
                    });
                    await this.checkpointStore.setCheckpoint("src", {
                        lastSignature: logs.signature,
                        blockTime,
                    });
                    logger.info({ signature: logs.signature, orderId }, "OrderCreated indexed");
                }
            }
        } catch (err) {
            logger.debug({ err, signature: logs.signature }, "Failed to parse src logs");
        }
    }
    private async handleDstLogs(logs: Logs): Promise<void> {
        if (logs.err) return;
        try {
            const events = dstEventParser.parseLogs(logs.logs);
            for (const event of events) {
                if (event.name === "Fulfilled") {
                    const data = event.data as { orderId: number[] };
                    const orderId = Buffer.from(data.orderId).toString("hex");
                    const blockTime = Math.floor(Date.now() / 1000);
                    await this.analytics.insertOrder({
                        orderId,
                        signature: logs.signature,
                        time: blockTime,
                        usdValue: 0, // TODO: calculate USD value
                        kind: "OrderFulfilled",
                    });
                    await this.checkpointStore.setCheckpoint("dst", {
                        lastSignature: logs.signature,
                        blockTime,
                    });
                    logger.info({ signature: logs.signature, orderId }, "OrderFulfilled indexed");
                }
            }
        } catch (err) {
            logger.debug({ err, signature: logs.signature }, "Failed to parse dst logs");
        }
    }
}
