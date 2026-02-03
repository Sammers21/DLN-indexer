import { createClient, ClickHouseClient } from "@clickhouse/client";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import type {
  Analytics,
  DailyVolume,
  Order,
  OrderEventType,
  OrderKind,
} from "../types.js";

const logger = createLogger("clickhouse");

export class Clickhouse implements Analytics {
  private readonly client: ClickHouseClient;
  private readonly database?: string;
  constructor(host?: string) {
    this.client = createClient({
      url: host ?? config.clickhouse.host,
      database: config.clickhouse.database,
      username: config.clickhouse.username,
      password: config.clickhouse.password,
    });
    this.database = config.clickhouse.database;
    logger.info("ClickHouse client initialized");
  }

  async insertOrders(orders: Order[]): Promise<void> {
    if (orders.length === 0) return;
    const values = orders.map((order) => ({
      order_id: order.orderId,
      tx_signature: order.signature,
      block_time: Clickhouse.formatDateTime(order.time),
      usd_value: order.usdValue,
      pricing_status: order.pricingStatus,
      pricing_error: order.pricingError,
      event_type: order.kind === "OrderCreated" ? "created" : "fulfilled",
    }));
    await this.client.insert({
      table: this.table("orders"),
      values,
      format: "JSONEachRow",
    });
    logger.debug({ count: orders.length }, "Orders inserted");
  }

  async getOrderCount(kind: OrderKind): Promise<number> {
    const eventType = kind === "OrderCreated" ? "created" : "fulfilled";
    const result = await this.client.query({
      query: `SELECT count() as cnt FROM ${this.table("orders")} WHERE event_type = {eventType:String}`,
      query_params: { eventType },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ cnt: string }>;
    return rows.length > 0 ? parseInt(rows[0].cnt, 10) : 0;
  }

  async getDefaultRange(): Promise<{ from: string; to: string }> {
    const result = await this.client.query({
      query: `
                SELECT
                    count() as cnt,
                    toString(min(toDate(block_time))) as min_date,
                    toString(max(toDate(block_time))) as max_date
                FROM ${this.table("orders")} FINAL
            `,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as unknown as Array<{
      cnt: string;
      min_date: string;
      max_date: string;
    }>;
    const row = rows[0];
    if (!row || parseInt(row.cnt, 10) === 0) return { from: "", to: "" };
    return { from: row.min_date, to: row.max_date };
  }

  async getDailyVolume(params: {
    eventType: OrderEventType;
    from?: string;
    to?: string;
  }): Promise<DailyVolume[]> {
    const conditions: string[] = ["event_type = {eventType:String}"];
    const queryParams: Record<string, string> = { eventType: params.eventType };
    if (params.from) {
      conditions.push("date >= {from:Date}");
      queryParams.from = params.from.slice(0, 10);
    }
    if (params.to) {
      conditions.push("date <= {to:Date}");
      queryParams.to = params.to.slice(0, 10);
    }
    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.client.query({
      query: `
                SELECT
                    toString(date) as period,
                    sum(order_count) as order_count,
                    sum(volume_usd) as volume_usd
                FROM ${this.table("daily_volumes_mv")} FINAL
                ${whereClause}
                GROUP BY date
                ORDER BY date ASC
            `,
      query_params: queryParams,
      format: "JSONEachRow",
    });
    return (await result.json()) as unknown as DailyVolume[];
  }

  async close(): Promise<void> {
    await this.client.close();
    logger.info("ClickHouse client closed");
  }

  private table(name: string): string {
    if (!this.database) return name;
    return `${this.database}.${name}`;
  }

  private static formatDateTime(unixSeconds: number): string {
    const iso = new Date(unixSeconds * 1000).toISOString().slice(0, 19);
    return iso.replace("T", " ");
  }
}
