import {
    Connection,
    PublicKey,
    ConfirmedSignatureInfo,
    VersionedTransactionResponse,
} from "@solana/web3.js";
import { config, createLogger } from "@dln/shared";

const logger = createLogger("solana");

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 1000;

export class SolanaClient {
    private readonly connection: Connection;
    private readonly rps: number;
    private readonly timestamps: number[];
    private ringIndex = 0;
    private readonly mutex: Promise<void>[] = [];
    constructor(rpcUrl?: string, rps?: number) {
        this.connection = new Connection(rpcUrl ?? config.solana.rpcUrl, {
            commitment: "confirmed",
        });
        this.rps = rps ?? config.solana.rps;
        // Initialize ring buffer with current timestamp
        const now = Date.now();
        this.timestamps = new Array(this.rps).fill(now);
        logger.info({ rpcUrl: rpcUrl ?? config.solana.rpcUrl, rps: this.rps }, "Solana client initialized");
    }
    private async waitForRateLimit(): Promise<void> {
        // Wait for any pending rate limit checks to complete (serialize access)
        const pending = this.mutex[0];
        let resolve: () => void;
        const promise = new Promise<void>((r) => (resolve = r));
        this.mutex.push(promise);
        if (pending) await pending;
        try {
            const now = Date.now();
            const oldestTimestamp = this.timestamps[this.ringIndex];
            const elapsed = now - oldestTimestamp;
            // If the oldest request was less than 1 second ago, wait
            if (elapsed < 1000) {
                await this.sleep(1000 - elapsed);
            }
            // Update the ring buffer with current timestamp
            this.timestamps[this.ringIndex] = Date.now();
            this.ringIndex = (this.ringIndex + 1) % this.rps;
        } finally {
            this.mutex.shift();
            resolve!();
        }
    }
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                await this.waitForRateLimit();
                return await fn();
            } catch (err) {
                lastError = err as Error;
                const is429 = lastError.message?.includes("429") || lastError.message?.includes("Too Many Requests");
                if (is429 && attempt < MAX_RETRIES - 1) {
                    const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
                    logger.warn({ attempt: attempt + 1, delay }, "Rate limited (429), backing off...");
                    await this.sleep(delay);
                } else {
                    throw lastError;
                }
            }
        }
        throw lastError;
    }
    async getSignaturesForAddress(
        address: PublicKey,
        options?: { limit?: number; until?: string }
    ): Promise<ConfirmedSignatureInfo[]> {
        return this.withRetry(() => this.connection.getSignaturesForAddress(address, options));
    }
    async getTransaction(
        signature: string
    ): Promise<VersionedTransactionResponse | null> {
        return this.withRetry(() =>
            this.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
            })
        );
    }
}
