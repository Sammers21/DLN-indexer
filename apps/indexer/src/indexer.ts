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

// Convert big-endian byte array to bigint
function bytesToBigInt(bytes: number[]): bigint {
    let result = BigInt(0);
    for (const byte of bytes) {
        result = (result << BigInt(8)) + BigInt(byte);
    }
    return result;
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
        logger.info({
            kind: this.kind,
            lastSignature: this.checkpoint?.lastSignature ?? "none",
            blockTime: this.checkpoint ? formatTime(this.checkpoint.blockTime) : "none",
        }, "Starting indexing");
        while (this.running) {
            try {
                // Fetch signatures after the checkpoint (newest first)
                const signatures = await this.fetchSignatures(
                    this.programId,
                    this.checkpoint?.lastSignature ?? null,
                    config.indexer.batchSize
                );
                if (signatures.length === 0) {
                    logger.debug({ kind: this.kind }, "No new signatures, waiting...");
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
                    const orders = await this.parseTransactionLogs(tx, sigInfo);
                    allOrders.push(...orders);
                    latestSigInfo = sigInfo;
                }
                // Batch insert all orders
                if (allOrders.length > 0) {
                    await this.analytics.insertOrders(allOrders);
                    // Save OrderCreated to storage for later lookup by OrderFulfilled
                    if (this.kind === "OrderCreated") {
                        for (const order of allOrders) {
                            await this.orderStorage.saveOrder(order);
                        }
                    }
                    for (const order of allOrders) {
                        logger.info({
                            signature: order.signature,
                            orderId: order.orderId,
                            kind: this.kind,
                            usdValue: order.usdValue,
                            time: formatTime(order.time),
                        }, "Order indexed");
                    }
                }
                // Update checkpoint to the last processed signature
                if (latestSigInfo) {
                    const checkpointTime = latestSigInfo.blockTime ?? Math.floor(Date.now() / 1000);
                    this.checkpoint = {
                        lastSignature: latestSigInfo.signature,
                        blockTime: checkpointTime,
                    };
                    await this.checkpointStore.setCheckpoint(this.programType, this.checkpoint);
                    logger.info({
                        kind: this.kind,
                        processed: allOrders.length,
                        checkpointSignature: this.checkpoint.lastSignature,
                        checkpointTime: formatTime(checkpointTime),
                    }, "Batch processed, checkpoint saved");
                    await this.sleep(config.indexer.delayMs);
                } else {
                    logger.info({ kind: this.kind, processed: 0 }, "Batch processed, no new orders, sleeping 10s...");
                    await this.sleep(10000);
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
    private async parseTransactionLogs(
        tx: VersionedTransactionResponse,
        sigInfo: ConfirmedSignatureInfo
    ): Promise<Order[]> {
        const orders: Order[] = [];
        if (!tx.meta?.logMessages) return orders;
        try {
            const events = this.eventParser.parseLogs(tx.meta.logMessages);
            const eventsList = Array.from(events);
            if (eventsList.length > 0) {
                logger.debug({
                    signature: sigInfo.signature,
                    kind: this.kind,
                    eventsFound: eventsList.map((e) => e.name),
                }, "Events found in transaction");
            }
            if (this.kind === "OrderCreated") {
                // For OrderCreated, we need both CreatedOrder (has amounts) and CreatedOrderId (has orderId)
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
                if (createdOrderData && orderId) {
                    // Extract give token and amount (what maker is giving)
                    const giveTokenBytes = createdOrderData.order.give.tokenAddress;
                    const giveAmountBytes = createdOrderData.order.give.amount;
                    // Calculate USD value using Jupiter price
                    const usdValue = await getUsdValue(giveTokenBytes, giveAmountBytes);
                    orders.push({
                        orderId,
                        signature: sigInfo.signature,
                        time: sigInfo.blockTime ?? Math.floor(Date.now() / 1000),
                        usdValue,
                        kind: this.kind,
                    });
                }
            } else {
                // For OrderFulfilled, look up the original order's USD value from storage
                for (const event of eventsList) {
                    if (event.name === "Fulfilled") {
                        const data = event.data as unknown as FulfilledData;
                        const orderId = Buffer.from(data.orderId).toString("hex");
                        // Look up the original OrderCreated to get its USD value
                        let usdValue = 0;
                        const storedOrder = await this.orderStorage.findOrderById(orderId);
                        if (storedOrder) {
                            usdValue = storedOrder.usdValue;
                            logger.debug({ orderId, usdValue }, "Found original order USD value");
                        } else {
                            logger.debug({ orderId }, "Original order not found in storage");
                        }
                        orders.push({
                            orderId,
                            signature: sigInfo.signature,
                            time: sigInfo.blockTime ?? Math.floor(Date.now() / 1000),
                            usdValue,
                            kind: this.kind,
                        });
                    }
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
