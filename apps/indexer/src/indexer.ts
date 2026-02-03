import { PublicKey, ConfirmedSignatureInfo, VersionedTransactionResponse } from "@solana/web3.js";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { config, createLogger, DLN_SRC_IDL, DLN_DST_IDL, Analytics, Order, OrderKind } from "@dln/shared";
import { Checkpoint, CheckpointBoundary, CheckpointStore, ProgramType } from "./checkpoint";
import { SolanaClient } from "./solana";
import { getUsdValue } from "./price";
import { getUsdValueFromDlnApi } from "./dln-api";

const logger = createLogger("indexer");

type Direction = "forward" | "backward";

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
        kind: OrderKind
    ) {
        this.solana = solana;
        this.checkpointStore = checkpointStore;
        this.analytics = analytics;
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
        if (this.checkpoint) {
            logger.info({
                kind: this.kind,
                from: { signature: this.checkpoint.from.signature.slice(0, 16) + "...", blockTime: formatTime(this.checkpoint.from.blockTime) },
                to: { signature: this.checkpoint.to.signature.slice(0, 16) + "...", blockTime: formatTime(this.checkpoint.to.blockTime) },
            }, "Starting indexing with existing checkpoint");
        } else {
            logger.info({ kind: this.kind }, "Starting indexing (no checkpoint)");
        }
        while (this.running) {
            try {
                // 1. Fetch new transactions (upwards/forward) with pagination to avoid skips
                const signaturesUpwards = await this.getForwardSignatures();
                // Process upwards signatures (oldest-first for chronological order)
                if (signaturesUpwards.length > 0) {
                    for (const sigInfo of signaturesUpwards) {
                        if (!this.running) break;
                        await this.handleSignature(sigInfo, "forward");
                    }
                }
                // 2. If upwards batch is small, also fetch backwards
                if (signaturesUpwards.length < config.indexer.batchSize && this.checkpoint) {
                    const signaturesBackwards = await this.solana.getSignaturesForAddress(this.programId, {
                        limit: config.indexer.batchSize,
                        before: this.checkpoint.from.signature,
                    });
                    // Process backwards signatures (newest-first, going back in time)
                    for (const sigInfo of signaturesBackwards) {
                        if (!this.running) break;
                        await this.handleSignature(sigInfo, "backward");
                    }
                    // If both directions have no signatures, sleep
                    if (signaturesUpwards.length === 0 && signaturesBackwards.length === 0) {
                        logger.info(`${this.kind} indexer: No new signatures, waiting ${config.indexer.delayMs}ms`);
                        await this.sleep(config.indexer.delayMs);
                    }
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
    private async getForwardSignatures(): Promise<ConfirmedSignatureInfo[]> {
        const limit = config.indexer.batchSize;
        if (!this.checkpoint) {
            const batch = await this.solana.getSignaturesForAddress(this.programId, { limit });
            return batch.reverse();
        }
        const checkpointSig = this.checkpoint.to.signature;
        const newestFirst: ConfirmedSignatureInfo[] = [];
        let before: string | undefined = undefined;
        while (true) {
            const batch = await this.solana.getSignaturesForAddress(this.programId, { limit, before });
            if (batch.length === 0) break;
            const checkpointIndex = batch.findIndex((sig) => sig.signature === checkpointSig);
            if (checkpointIndex >= 0) {
                if (checkpointIndex > 0) newestFirst.push(...batch.slice(0, checkpointIndex));
                break;
            }
            newestFirst.push(...batch);
            if (batch.length < limit) break;
            before = batch[batch.length - 1].signature;
        }
        if (newestFirst.length === 0) return [];
        return newestFirst.reverse();
    }
    private async handleSignature(sigInfo: ConfirmedSignatureInfo, direction: Direction): Promise<void> {
        if (sigInfo.err) {
            // Skip failed transactions but still update checkpoint
            await this.updateCheckpoint(sigInfo, direction);
            return;
        }
        // Fetch transaction
        const tx = await this.solana.getTransaction(sigInfo.signature);
        if (!tx) {
            logger.warn({ signature: sigInfo.signature }, "Transaction not found");
            await this.updateCheckpoint(sigInfo, direction);
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
                direction,
            }, "Order indexed");
        }
        // Update checkpoint
        await this.updateCheckpoint(sigInfo, direction);
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
        await this.analytics.insertOrders([order]);
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
            // Fetch USD value from DLN API
            const usdValue = await getUsdValueFromDlnApi(orderId);
            const order: Order = {
                orderId,
                signature: sigInfo.signature,
                time: txBlockTime,
                usdValue,
                kind: this.kind,
            };
            await this.analytics.insertOrders([order]);
            return order;
        }
        return null;
    }
    private async updateCheckpoint(sigInfo: ConfirmedSignatureInfo, direction: Direction): Promise<void> {
        const now = Date.now();
        const blockTime = sigInfo.blockTime ?? Math.floor(now / 1000);
        const boundary: CheckpointBoundary = {
            signature: sigInfo.signature,
            blockTime,
        };
        if (!this.checkpoint) {
            // Initialize checkpoint with both from and to pointing to this signature
            this.checkpoint = { from: boundary, to: boundary };
        } else if (direction === "forward") {
            // Update the "to" boundary (newest)
            this.checkpoint = { ...this.checkpoint, to: boundary };
        } else {
            // Update the "from" boundary (oldest)
            this.checkpoint = { ...this.checkpoint, from: boundary };
        }
        // Only save to Redis if more than 1 second since last save
        if (now - this.lastCheckpointSaveTime >= 1000) {
            await this.checkpointStore.setCheckpoint(this.programType, this.checkpoint);
            this.lastCheckpointSaveTime = now;
            logger.info(
                `${this.kind} checkpoint saved [${direction}]: ` +
                `from=${this.checkpoint.from.signature.slice(0, 16)}... (${formatTime(this.checkpoint.from.blockTime)}), ` +
                `to=${this.checkpoint.to.signature.slice(0, 16)}... (${formatTime(this.checkpoint.to.blockTime)})`
            );
        }
    }
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
