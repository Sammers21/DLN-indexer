import { createClient, ClickHouseClient } from "@clickhouse/client";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import type { Analytics, Order, OrderKind, DailyVolume } from "../types.js";

const logger = createLogger("clickhouse");

// --- Clickhouse class (used by indexer) ---

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

// --- Standalone query functions (used by API) ---

let queryClient: ClickHouseClient | null = null;

function getQueryClient(): ClickHouseClient {
    if (!queryClient) {
        queryClient = createClient({
            url: config.clickhouse.host,
            database: config.clickhouse.database,
            username: config.clickhouse.username,
            password: config.clickhouse.password,
        });
        logger.info("ClickHouse query client initialized");
    }
    return queryClient;
}

export async function getOrders(params: {
    page?: number;
    limit?: number;
    eventType?: string;
    startDate?: string;
    endDate?: string;
}): Promise<{ orders: Record<string, unknown>[]; total: number }> {
    const ch = getQueryClient();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const queryParams: Record<string, string | number> = {};
    if (params.eventType) {
        conditions.push("event_type = {eventType:String}");
        queryParams.eventType = params.eventType;
    }
    if (params.startDate) {
        conditions.push("block_time >= {startDate:DateTime64(3)}");
        queryParams.startDate = params.startDate;
    }
    if (params.endDate) {
        conditions.push("block_time <= {endDate:DateTime64(3)}");
        queryParams.endDate = params.endDate;
    }
    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await ch.query({
        query: `SELECT count() as total FROM orders FINAL ${whereClause}`,
        query_params: queryParams,
        format: "JSONEachRow",
    });
    const countData = await countResult.json<{ total: string }>();
    const countArray = countData as unknown as { total: string }[];
    const total = parseInt(countArray[0]?.total || "0", 10);
    const ordersResult = await ch.query({
        query: `
      SELECT * FROM orders FINAL
      ${whereClause}
      ORDER BY block_time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
        query_params: { ...queryParams, limit, offset },
        format: "JSONEachRow",
    });
    const orders = (await ordersResult.json()) as unknown as Record<string, unknown>[];
    return { orders, total };
}

export async function getDailyVolumes(params: {
    startDate?: string;
    endDate?: string;
}): Promise<DailyVolume[]> {
    const ch = getQueryClient();
    const conditions: string[] = [];
    const queryParams: Record<string, string> = {};
    if (params.startDate) {
        conditions.push("date >= {startDate:Date}");
        queryParams.startDate = params.startDate;
    }
    if (params.endDate) {
        conditions.push("date <= {endDate:Date}");
        queryParams.endDate = params.endDate;
    }
    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await ch.query({
        query: `
      SELECT
        date,
        event_type,
        sum(order_count) as order_count,
        sum(volume_usd) as volume_usd
      FROM daily_volumes_mv FINAL
      ${whereClause}
      GROUP BY date, event_type
      ORDER BY date ASC
    `,
        query_params: queryParams,
        format: "JSONEachRow",
    });
    const data = await result.json<DailyVolume>();
    return data as unknown as DailyVolume[];
}

export async function getVolumeSummary(params: {
    startDate?: string;
    endDate?: string;
}): Promise<{
    total_created_volume_usd: number;
    total_fulfilled_volume_usd: number;
    total_created_count: number;
    total_fulfilled_count: number;
}> {
    const ch = getQueryClient();
    const conditions: string[] = [];
    const queryParams: Record<string, string> = {};
    if (params.startDate) {
        conditions.push("date >= {startDate:Date}");
        queryParams.startDate = params.startDate;
    }
    if (params.endDate) {
        conditions.push("date <= {endDate:Date}");
        queryParams.endDate = params.endDate;
    }
    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await ch.query({
        query: `
      SELECT
        sumIf(volume_usd, event_type = 'created') as total_created_volume_usd,
        sumIf(volume_usd, event_type = 'fulfilled') as total_fulfilled_volume_usd,
        sumIf(order_count, event_type = 'created') as total_created_count,
        sumIf(order_count, event_type = 'fulfilled') as total_fulfilled_count
      FROM daily_volumes_mv FINAL
      ${whereClause}
    `,
        query_params: queryParams,
        format: "JSONEachRow",
    });
    type SummaryResult = {
        total_created_volume_usd: number;
        total_fulfilled_volume_usd: number;
        total_created_count: number;
        total_fulfilled_count: number;
    };
    const data = await result.json<SummaryResult>();
    const dataArray = data as unknown as SummaryResult[];
    return (
        dataArray[0] || {
            total_created_volume_usd: 0,
            total_fulfilled_volume_usd: 0,
            total_created_count: 0,
            total_fulfilled_count: 0,
        }
    );
}
