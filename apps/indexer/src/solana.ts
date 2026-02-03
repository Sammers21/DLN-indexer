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
const METRICS_LOG_INTERVAL_MS = 60000;

type RpcMethod = "getSignaturesForAddress" | "getTransaction";

interface RpcMetrics {
    count: number;
    totalMs: number;
    errorCount: number;
}

export class SolanaClient {
    private readonly connection: Connection;
    private readonly rpcUrl: string;
    private readonly limiter: Bottleneck;
    private readonly metrics: Record<RpcMethod, RpcMetrics>;
    private lastMetricsLogMs: number;
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
        this.metrics = {
            getSignaturesForAddress: { count: 0, totalMs: 0, errorCount: 0 },
            getTransaction: { count: 0, totalMs: 0, errorCount: 0 },
        };
        this.lastMetricsLogMs = Date.now();
        logger.info({ rpcUrl: this.rpcUrl, rps: requestsPerSecond }, "Solana client initialized with bottleneck rate limiter");
    }
    private async withRetry<T>(name: RpcMethod, fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
        return this.limiter.schedule(async () => {
            let lastError: Error | null = null;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                try {
                    const start = Date.now();
                    const result = await fn();
                    const timeMs = Date.now() - start;
                    this.recordMetrics(name, timeMs, false);
                    return { result, timeMs };
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
            this.recordMetrics(name, null, true);
            throw lastError ?? new Error("RPC call failed without an error payload");
        });
    }
    async getSignaturesForAddress(
        address: PublicKey,
        options?: { limit?: number; until?: string; before?: string }
    ): Promise<ConfirmedSignatureInfo[]> {
        const { result, timeMs } = await this.withRetry("getSignaturesForAddress", () =>
            this.connection.getSignaturesForAddress(address, options)
        );
        logger.debug({ count: result.length, timeMs }, "getSignaturesForAddress");
        return result;
    }
    async getTransaction(
        signature: string
    ): Promise<VersionedTransactionResponse | null> {
        const { result, timeMs } = await this.withRetry("getTransaction", () =>
            this.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
            })
        );
        logger.debug({ signature: signature.slice(0, 16) + "...", timeMs, found: result !== null }, "getTransaction");
        return result;
    }
    private recordMetrics(method: RpcMethod, timeMs: number | null, failed: boolean): void {
        const entry = this.metrics[method];
        if (timeMs !== null) {
            entry.count += 1;
            entry.totalMs += timeMs;
        }
        if (failed) entry.errorCount += 1;
        this.maybeLogMetrics();
    }
    private maybeLogMetrics(): void {
        const now = Date.now();
        const windowMs = now - this.lastMetricsLogMs;
        if (windowMs < METRICS_LOG_INTERVAL_MS) return;
        const methods: Record<RpcMethod, { count: number; errorCount: number; avgMs: number }> = {
            getSignaturesForAddress: this.buildMetricsSnapshot("getSignaturesForAddress"),
            getTransaction: this.buildMetricsSnapshot("getTransaction"),
        };
        logger.info({ windowMs, methods }, "Solana RPC metrics");
        for (const method of Object.keys(this.metrics) as RpcMethod[]) {
            this.metrics[method].count = 0;
            this.metrics[method].totalMs = 0;
            this.metrics[method].errorCount = 0;
        }
        this.lastMetricsLogMs = now;
    }
    private buildMetricsSnapshot(method: RpcMethod): { count: number; errorCount: number; avgMs: number } {
        const entry = this.metrics[method];
        const avgMs = entry.count > 0 ? entry.totalMs / entry.count : 0;
        return { count: entry.count, errorCount: entry.errorCount, avgMs };
    }
}
