import { createClient, ClickHouseClient } from "@clickhouse/client";
import { config, createLogger } from "@dln/shared";
import { Analytics, Order, OrderKind } from "../analytics";

const logger = createLogger("clickhouse");

export class Clickhouse implements Analytics {
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
    async insertOrders(orders: Order[]): Promise<void> {
        if (orders.length === 0) return;
        const values = orders.map((order) => ({
            order_id: order.orderId,
            tx_signature: order.signature,
            block_time: new Date(order.time * 1000).toISOString().slice(0, 19),
            usd_value: order.usdValue,
            event_type: order.kind === "OrderCreated" ? "created" : "fulfilled",
        }));
        await this.client.insert({
            table: "dln.orders",
            values,
            format: "JSONEachRow",
        });
        logger.debug({ count: orders.length }, "Orders inserted");
    }
    async getOrderCount(kind: OrderKind): Promise<number> {
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
