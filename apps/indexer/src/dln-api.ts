import { createLogger } from "@dln/shared";
import Bottleneck from "bottleneck";
import { getTokenPrice, getTokenDecimals, calculateUsdValue } from "./price";

const logger = createLogger("dln-api");

const DLN_API_BASE = "https://dln-api.debridge.finance/api";
const SOLANA_CHAIN_ID = 7565164;

// Native SOL -> wrapped SOL for Jupiter
const NATIVE_SOL = "11111111111111111111111111111111";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

// Rate limiter: 1 RPS for DLN API
const limiter = new Bottleneck({ minTime: 1000, maxConcurrent: 1 });

// DLN API response type
interface DlnOrderLiteModel {
    orderId: { stringValue: string };
    takeOffer: {
        chainId: { bigIntegerValue: number };
        tokenAddress: { stringValue: string };
        amount: { stringValue: string };
    };
}

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get USD value for a fulfilled order from DLN API + Jupiter
 */
export async function getUsdValueFromDlnApi(orderId: string): Promise<number> {
    const orderIdHex = orderId.startsWith("0x") ? orderId : `0x${orderId}`;
    const url = `${DLN_API_BASE}/Orders/${orderIdHex}/liteModel`;
    let delayMs = RETRY_DELAY_MS;
    // Fetch order from DLN API with retry
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await limiter.schedule(() => fetch(url));
            if (response.ok) {
                const data = (await response.json()) as DlnOrderLiteModel;
                // Verify order is on Solana
                if (data.takeOffer.chainId.bigIntegerValue !== SOLANA_CHAIN_ID) {
                    logger.warn({ orderId: orderId.slice(0, 16), chainId: data.takeOffer.chainId.bigIntegerValue }, "Order not on Solana");
                    return -1;
                }
                // Get Solana token price from Jupiter
                const mint = data.takeOffer.tokenAddress.stringValue === NATIVE_SOL
                    ? WRAPPED_SOL
                    : data.takeOffer.tokenAddress.stringValue;
                const amount = BigInt(data.takeOffer.amount.stringValue);
                if (amount === BigInt(0)) return 0;
                const price = await getTokenPrice(mint);
                if (price === null) {
                    logger.warn({ orderId: orderId.slice(0, 16), mint }, "No Jupiter price available");
                    return -1;
                }
                const decimals = getTokenDecimals(mint);
                const usdValue = calculateUsdValue(amount, decimals, price);
                logger.debug({ orderId: orderId.slice(0, 16), mint, price, usdValue }, "USD value calculated");
                return usdValue;
            }
            if (response.status === 404) {
                logger.error({ orderId: orderId.slice(0, 16) }, "Order not found in DLN API");
                return -1;
            }
            if (response.status === 429 && attempt < MAX_RETRIES) {
                logger.warn({ orderId: orderId.slice(0, 16), attempt, delayMs }, "DLN API rate limited, retrying...");
                await sleep(delayMs);
                delayMs = Math.min(delayMs * 2, 30000);
                continue;
            }
            logger.warn({ status: response.status, orderId: orderId.slice(0, 16) }, "DLN API error");
            return -1;
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                logger.warn({ err, orderId: orderId.slice(0, 16), attempt }, "DLN API request failed, retrying...");
                await sleep(delayMs);
                delayMs = Math.min(delayMs * 2, 30000);
                continue;
            }
            logger.error({ err, orderId: orderId.slice(0, 16) }, "Failed to fetch from DLN API");
            return -1;
        }
    }
    return -1;
}
