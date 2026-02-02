import { createClient, ClickHouseClient } from "@clickhouse/client";
import { config, createLogger } from "@dln/shared";
import {
    Analytics,
    AnalyticsEvent,
    EventKind,
    OrderCreatedEvent,
    OrderFulfilledEvent,
} from "./analytics";

const logger = createLogger("clickhouse");

export class ClickHouseAnalytics implements Analytics {
    private readonly client: ClickHouseClient;
    constructor(host?: string) {
        this.client = createClient({
            url: host ?? config.clickhouse.host,
            database: config.clickhouse.database,
            username: config.clickhouse.username,
            password: config.clickhouse.password,
        });
        logger.info("ClickHouse client initialized");
    }
    async insertEvent(event: AnalyticsEvent): Promise<void> {
        if (event.kind === "OrderCreated") {
            await this.insertOrderCreated(event.data);
        } else {
            await this.insertOrderFulfilled(event.data);
        }
    }
    private async insertOrderCreated(data: OrderCreatedEvent): Promise<void> {
        await this.client.insert({
            table: "dln.orders",
            values: [
                {
                    tx_signature: data.signature,
                    event_type: "created",
                    block_time: new Date(data.blockTime * 1000).toISOString().slice(0, 19),
                    give_chain_id: data.giveChainId,
                    give_token_address: data.giveToken,
                    give_amount: data.giveAmount.toString(),
                    take_chain_id: data.takeChainId,
                    take_token_address: data.takeToken,
                    take_amount: data.takeAmount.toString(),
                },
            ],
            format: "JSONEachRow",
        });
        logger.debug({ signature: data.signature }, "OrderCreated inserted");
    }
    private async insertOrderFulfilled(data: OrderFulfilledEvent): Promise<void> {
        await this.client.insert({
            table: "dln.orders",
            values: [
                {
                    tx_signature: data.signature,
                    event_type: "fulfilled",
                    block_time: new Date(data.blockTime * 1000).toISOString().slice(0, 19),
                    order_id: data.orderId,
                    taker: data.taker,
                },
            ],
            format: "JSONEachRow",
        });
        logger.debug({ signature: data.signature, orderId: data.orderId }, "OrderFulfilled inserted");
    }
    async getEventCount(kind: EventKind): Promise<number> {
        const eventType = kind === "OrderCreated" ? "created" : "fulfilled";
        const result = await this.client.query({
            query: `SELECT count() as cnt FROM dln.orders WHERE event_type = {eventType:String}`,
            query_params: { eventType },
            format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{ cnt: string }>;
        return rows.length > 0 ? parseInt(rows[0].cnt, 10) : 0;
    }
    async close(): Promise<void> {
        await this.client.close();
        logger.info("ClickHouse client closed");
    }
}
