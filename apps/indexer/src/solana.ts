import {
    Connection,
    PublicKey,
    ConfirmedSignatureInfo,
    VersionedTransactionResponse,
} from "@solana/web3.js";
import Bottleneck from "bottleneck";
import { config, createLogger } from "@dln/shared";

const logger = createLogger("solana");

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 1000;

export class SolanaClient {
    private readonly connection: Connection;
    private readonly rpcUrl: string;
    private readonly limiter: Bottleneck;
    constructor(rpcUrl?: string, rps?: number) {
        this.rpcUrl = rpcUrl ?? config.solana.rpcUrl;
        const requestsPerSecond = rps ?? config.solana.rps;
        // Configure bottleneck for rate limiting
        this.limiter = new Bottleneck({
            reservoir: requestsPerSecond,
            reservoirRefreshInterval: 1000,
            reservoirRefreshAmount: requestsPerSecond,
            maxConcurrent: 1,
            minTime: Math.floor(1000 / requestsPerSecond),
        });
        // Log when we're being rate limited by bottleneck
        this.limiter.on("depleted", () => {
            logger.info("Rate limiter depleted, waiting for refresh...");
        });
        this.connection = new Connection(this.rpcUrl, {
            commitment: "confirmed",
        });
        logger.info({ rpcUrl: this.rpcUrl, rps: requestsPerSecond }, "Solana client initialized with bottleneck rate limiter");
    }
    private async withRetry<T>(name: string, fn: () => Promise<T>): Promise<T> {
        return this.limiter.schedule(async () => {
            let lastError: Error | null = null;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                try {
                    return await fn();
                } catch (err) {
                    lastError = err as Error;
                    const is429 = lastError.message?.includes("429") || lastError.message?.includes("Too Many Requests");
                    if (is429) {
                        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
                        logger.warn({ attempt: attempt + 1, delay, method: name }, "429 rate limited, backing off...");
                        await new Promise((r) => setTimeout(r, delay));
                        continue;
                    }
                    if (attempt < MAX_RETRIES - 1) {
                        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
                        logger.warn({ attempt: attempt + 1, delay, method: name, error: lastError.message }, "RPC call failed, retrying...");
                        await new Promise((r) => setTimeout(r, delay));
                        continue;
                    }
                    throw lastError;
                }
            }
            throw lastError;
        });
    }
    async getSignaturesForAddress(
        address: PublicKey,
        options?: { limit?: number; until?: string }
    ): Promise<ConfirmedSignatureInfo[]> {
        return this.withRetry("getSignaturesForAddress", () =>
            this.connection.getSignaturesForAddress(address, options)
        );
    }
    async getTransaction(
        signature: string
    ): Promise<VersionedTransactionResponse | null> {
        return this.withRetry("getTransaction", () =>
            this.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
            })
        );
    }
}
