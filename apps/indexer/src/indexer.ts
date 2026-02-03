import { PublicKey, ConfirmedSignatureInfo, VersionedTransactionResponse } from "@solana/web3.js";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { config, createLogger, DLN_SRC_IDL, DLN_DST_IDL } from "@dln/shared";
import { Checkpoint, CheckpointStore, ProgramType } from "./checkpoint";
import { Analytics, Order, OrderKind } from "./analytics";
import { SolanaClient } from "./solana";
import { getUsdValue } from "./price";
import { OrderStorage } from "./storage";

const logger = createLogger("indexer");

function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

// Offer struct from DLN
interface Offer {
    chainId: number[];
    tokenAddress: number[];
    amount: number[];
}

// Order struct from CreatedOrder event
interface DlnOrder {
    makerOrderNonce: bigint;
    makerSrc: number[];
    give: Offer;
    take: Offer;
    receiverDst: number[];
    givePatchAuthoritySrc: number[];
    orderAuthorityAddressDst: number[];
    allowedTakerDst: number[] | null;
    allowedCancelBeneficiarySrc: number[] | null;
    externalCall: { externalCallShortcut: number[] } | null;
}

// CreatedOrder event data
interface CreatedOrderData {
    order: DlnOrder;
    fixFee: bigint;
    percentFee: bigint;
}

// Fulfilled event data
interface FulfilledData {
    orderId: number[];
    taker: PublicKey;
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
    private readonly orderStorage: OrderStorage;
    private readonly kind: OrderKind;
    private readonly programId: PublicKey;
    private readonly programType: ProgramType;
    private readonly eventParser: EventParser;
    private checkpoint: Checkpoint | null = null;
    private lastCheckpointSaveTime = 0;
    private running = false;
    constructor(
        solana: SolanaClient,
        checkpointStore: CheckpointStore,
        analytics: Analytics,
        orderStorage: OrderStorage,
        kind: OrderKind
    ) {
        this.solana = solana;
        this.checkpointStore = checkpointStore;
        this.analytics = analytics;
        this.orderStorage = orderStorage;
        this.kind = kind;
        this.programId = kind === "OrderCreated" ? DLN_SRC : DLN_DST;
        this.programType = kind === "OrderCreated" ? "src" : "dst";
        this.eventParser = kind === "OrderCreated" ? srcEventParser : dstEventParser;
    }
    getCheckpoint(): Checkpoint | null {
        return this.checkpoint;
    }
    async startIndexing(): Promise<void> {
        this.checkpoint = await this.checkpointStore.getCheckpoint(this.programType);
        this.running = true;
        this.lastCheckpointSaveTime = Date.now();
        logger.info({
            kind: this.kind,
            lastSignature: this.checkpoint?.lastSignature ?? "none",
            blockTime: this.checkpoint ? formatTime(this.checkpoint.blockTime) : "none",
        }, "Starting indexing");
        while (this.running) {
            try {
                // Step 1: Fetch new signatures (after checkpoint)
                // `until` stops when reaching the checkpoint signature
                const signatures = await this.solana.getSignaturesForAddress(this.programId, {
                    limit: config.indexer.batchSize,
                    until: this.checkpoint?.lastSignature,
                });
                if (signatures.length === 0) {
                    logger.info(`${this.kind} indexer: No new signatures, waiting ${config.indexer.delayMs}ms`);
                    await this.sleep(config.indexer.delayMs);
                    continue;
                }
                // Signatures come newest-first, reverse to process oldest-first (chronological)
                const chronological = signatures.reverse();
                // Step 2: Process each transaction one by one
                for (const sigInfo of chronological) {
                    if (!this.running) break;
                    await this.handleSignature(sigInfo);
                }
            } catch (err) {
                logger.error({ err, kind: this.kind }, "Error during indexing, retrying...");
                await this.sleep(config.indexer.delayMs * 2);
            }
        }
    }
    stop(): void {
        this.running = false;
        logger.info({ kind: this.kind }, "Indexer stopping");
    }
    private async handleSignature(sigInfo: ConfirmedSignatureInfo): Promise<void> {
        if (sigInfo.err) {
            // Skip failed transactions but still update checkpoint
            await this.updateCheckpoint(sigInfo);
            return;
        }
        // Fetch transaction
        const tx = await this.solana.getTransaction(sigInfo.signature);
        if (!tx) {
            logger.warn({ signature: sigInfo.signature }, "Transaction not found");
            await this.updateCheckpoint(sigInfo);
            return;
        }
        // Parse and process
        const order = await this.processTransaction(tx, sigInfo);
        if (order) {
            logger.info({
                signature: sigInfo.signature,
                usdValue: order.usdValue,
                orderId: order.orderId,
                kind: this.kind,
                time: formatTime(order.time),
            }, "Order indexed");
        }
        // Update checkpoint
        await this.updateCheckpoint(sigInfo);
    }
    private async processTransaction(
        tx: VersionedTransactionResponse,
        sigInfo: ConfirmedSignatureInfo
    ): Promise<Order | null> {
        if (!tx.meta?.logMessages) return null;
        const txBlockTime = sigInfo.blockTime ?? Math.floor(Date.now() / 1000);
        try {
            const events = this.eventParser.parseLogs(tx.meta.logMessages);
            const eventsList = Array.from(events);
            if (this.kind === "OrderCreated") {
                return await this.processOrderCreated(eventsList, sigInfo, txBlockTime);
            } else {
                return await this.processOrderFulfilled(eventsList, sigInfo, txBlockTime);
            }
        } catch (err) {
            logger.debug({ err, signature: sigInfo.signature }, "Failed to parse transaction logs");
            return null;
        }
    }
    private async processOrderCreated(
        eventsList: Array<{ name: string; data: unknown }>,
        sigInfo: ConfirmedSignatureInfo,
        txBlockTime: number
    ): Promise<Order | null> {
        let createdOrderData: CreatedOrderData | null = null;
        let orderId: string | null = null;
        for (const event of eventsList) {
            if (event.name === "CreatedOrder") {
                createdOrderData = event.data as unknown as CreatedOrderData;
            } else if (event.name === "CreatedOrderId") {
                const data = event.data as unknown as { orderId: number[] };
                orderId = Buffer.from(data.orderId).toString("hex");
            }
        }
        if (!createdOrderData || !orderId) return null;
        // Calculate USD value
        const giveTokenBytes = createdOrderData.order.give.tokenAddress;
        const giveAmountBytes = createdOrderData.order.give.amount;
        const usdValue = await getUsdValue(giveTokenBytes, giveAmountBytes);
        const order: Order = {
            orderId,
            signature: sigInfo.signature,
            time: txBlockTime,
            usdValue,
            kind: this.kind,
        };
        // Insert into ClickHouse
        await this.analytics.insertOrders([order]);
        // Save to OrderStorage for later lookup by OrderFulfilled
        await this.orderStorage.saveOrder(order);
        logger.debug({ orderId, usdValue }, "OrderCreated saved to storage");
        return order;
    }
    private async processOrderFulfilled(
        eventsList: Array<{ name: string; data: unknown }>,
        sigInfo: ConfirmedSignatureInfo,
        txBlockTime: number
    ): Promise<Order | null> {
        for (const event of eventsList) {
            if (event.name !== "Fulfilled") continue;
            const data = event.data as unknown as FulfilledData;
            const orderId = Buffer.from(data.orderId).toString("hex");
            // Wait until OrderCreated indexer has processed past this transaction's time
            await this.waitForOrderCreatedIndexer(txBlockTime);
            // Lookup the original OrderCreated
            const storedOrder = await this.orderStorage.findOrderById(orderId);
            if (!storedOrder) {
                logger.debug({ orderId }, "OrderCreated not found in storage, skipping OrderFulfilled");
                return null;
            }
            logger.info({ orderId, usdValue: storedOrder.usdValue }, "Found cached OrderCreated");
            const order: Order = {
                orderId,
                signature: sigInfo.signature,
                time: txBlockTime,
                usdValue: storedOrder.usdValue,
                kind: this.kind,
            };
            // Insert into ClickHouse
            await this.analytics.insertOrders([order]);
            return order;
        }
        return null;
    }
    private async waitForOrderCreatedIndexer(txBlockTime: number): Promise<void> {
        // Poll until OrderCreated checkpoint is ahead of this transaction
        while (this.running) {
            const srcCheckpoint = await this.checkpointStore.getCheckpoint("src");
            if (srcCheckpoint && srcCheckpoint.blockTime > txBlockTime) {
                return;
            }
            logger.debug({
                txBlockTime: formatTime(txBlockTime),
                srcCheckpointTime: srcCheckpoint ? formatTime(srcCheckpoint.blockTime) : "none",
            }, "Waiting for OrderCreated indexer to catch up");
            await this.sleep(1000);
        }
    }
    private async updateCheckpoint(sigInfo: ConfirmedSignatureInfo): Promise<void> {
        const now = Date.now();
        const blockTime = sigInfo.blockTime ?? Math.floor(now / 1000);
        this.checkpoint = {
            lastSignature: sigInfo.signature,
            blockTime,
        };
        // Only save to Redis if more than 1 second since last save
        if (now - this.lastCheckpointSaveTime >= 1000) {
            await this.checkpointStore.setCheckpoint(this.programType, this.checkpoint);
            this.lastCheckpointSaveTime = now;
            logger.debug({
                kind: this.kind,
                signature: sigInfo.signature,
                blockTime: formatTime(blockTime),
            }, "Checkpoint saved");
        }
    }
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
