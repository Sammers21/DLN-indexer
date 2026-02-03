import { describe, it } from "mocha";
import { expect } from "chai";
import { Clickhouse } from "@dln/shared";
import type { Order } from "@dln/shared";

type MockClient = {
    query: (args: { query: string; query_params?: Record<string, string>; format: string }) => Promise<{ json: () => Promise<unknown[]> }>;
    insert: (args: { table: string; values: unknown[]; format: string }) => Promise<void>;
};

function mockClient(clickhouse: Clickhouse): {
    client: MockClient;
    queryCalls: Array<{ query: string; params?: Record<string, string> }>;
    insertCalls: Array<{ table: string; values: unknown[] }>;
} {
    const queryCalls: Array<{ query: string; params?: Record<string, string> }> = [];
    const insertCalls: Array<{ table: string; values: unknown[] }> = [];
    const client: MockClient = {
        query: async (args) => {
            queryCalls.push({ query: args.query, params: args.query_params });
            return { json: async () => [] };
        },
        insert: async (args) => {
            insertCalls.push({ table: args.table, values: args.values });
        },
    };
    (clickhouse as unknown as { client: MockClient }).client = client;
    return { client, queryCalls, insertCalls };
}

describe("Clickhouse service", () => {
    describe("insertOrders", () => {
        it("does nothing for empty array", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { insertCalls } = mockClient(ch);
            await ch.insertOrders([]);
            expect(insertCalls).to.have.length(0);
        });

        it("inserts orders with correct field mapping", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { insertCalls } = mockClient(ch);
            const order: Order = {
                orderId: "abc123",
                signature: "sig456",
                time: 1704067200, // 2024-01-01 00:00:00 UTC
                usdValue: 100.5,
                pricingStatus: "ok",
                pricingError: null,
                kind: "OrderCreated",
            };
            await ch.insertOrders([order]);
            expect(insertCalls).to.have.length(1);
            expect(insertCalls[0].values).to.have.length(1);
            const row = insertCalls[0].values[0] as Record<string, unknown>;
            expect(row.order_id).to.equal("abc123");
            expect(row.tx_signature).to.equal("sig456");
            expect(row.usd_value).to.equal(100.5);
            expect(row.pricing_status).to.equal("ok");
            expect(row.pricing_error).to.equal(null);
            expect(row.event_type).to.equal("created");
        });

        it("maps OrderFulfilled to 'fulfilled' event type", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { insertCalls } = mockClient(ch);
            const order: Order = {
                orderId: "def789",
                signature: "sig101",
                time: 1704067200,
                usdValue: null,
                pricingStatus: "error",
                pricingError: "no_price",
                kind: "OrderFulfilled",
            };
            await ch.insertOrders([order]);
            const row = insertCalls[0].values[0] as Record<string, unknown>;
            expect(row.event_type).to.equal("fulfilled");
            expect(row.pricing_status).to.equal("error");
            expect(row.pricing_error).to.equal("no_price");
        });

        it("formats block_time as 'YYYY-MM-DD HH:MM:SS'", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { insertCalls } = mockClient(ch);
            const order: Order = {
                orderId: "test",
                signature: "sig",
                time: 1704067200, // 2024-01-01 00:00:00 UTC
                usdValue: 0,
                pricingStatus: "ok",
                pricingError: null,
                kind: "OrderCreated",
            };
            await ch.insertOrders([order]);
            const row = insertCalls[0].values[0] as Record<string, unknown>;
            expect(row.block_time).to.equal("2024-01-01 00:00:00");
        });

        it("inserts multiple orders in one call", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { insertCalls } = mockClient(ch);
            const orders: Order[] = [
                { orderId: "1", signature: "s1", time: 100, usdValue: 10, pricingStatus: "ok", pricingError: null, kind: "OrderCreated" },
                { orderId: "2", signature: "s2", time: 200, usdValue: 20, pricingStatus: "ok", pricingError: null, kind: "OrderFulfilled" },
            ];
            await ch.insertOrders(orders);
            expect(insertCalls).to.have.length(1);
            expect(insertCalls[0].values).to.have.length(2);
        });
    });

    describe("getOrderCount", () => {
        it("queries with correct event type for OrderCreated", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { queryCalls } = mockClient(ch);
            // Override to return a count
            (ch as unknown as { client: MockClient }).client.query = async (args) => {
                queryCalls.push({ query: args.query, params: args.query_params });
                return { json: async () => [{ cnt: "42" }] };
            };
            const count = await ch.getOrderCount("OrderCreated");
            expect(count).to.equal(42);
            expect(queryCalls[0].params!.eventType).to.equal("created");
        });

        it("queries with correct event type for OrderFulfilled", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { queryCalls } = mockClient(ch);
            (ch as unknown as { client: MockClient }).client.query = async (args) => {
                queryCalls.push({ query: args.query, params: args.query_params });
                return { json: async () => [{ cnt: "15" }] };
            };
            const count = await ch.getOrderCount("OrderFulfilled");
            expect(count).to.equal(15);
            expect(queryCalls[0].params!.eventType).to.equal("fulfilled");
        });

        it("returns 0 when no rows returned", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            mockClient(ch);
            const count = await ch.getOrderCount("OrderCreated");
            expect(count).to.equal(0);
        });
    });

    describe("getDefaultRange", () => {
        it("returns empty strings when no data", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            (ch as unknown as { client: MockClient }).client = {
                query: async () => ({ json: async () => [{ cnt: "0", min_date: "1970-01-01", max_date: "1970-01-01" }] }),
                insert: async () => {},
            };
            const range = await ch.getDefaultRange();
            expect(range.from).to.equal("");
            expect(range.to).to.equal("");
        });

        it("returns date range when data exists", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            (ch as unknown as { client: MockClient }).client = {
                query: async () => ({ json: async () => [{ cnt: "100", min_date: "2024-01-01", max_date: "2024-06-30" }] }),
                insert: async () => {},
            };
            const range = await ch.getDefaultRange();
            expect(range.from).to.equal("2024-01-01");
            expect(range.to).to.equal("2024-06-30");
        });

        it("returns empty strings when result is empty", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            (ch as unknown as { client: MockClient }).client = {
                query: async () => ({ json: async () => [] }),
                insert: async () => {},
            };
            const range = await ch.getDefaultRange();
            expect(range.from).to.equal("");
            expect(range.to).to.equal("");
        });
    });

    describe("getDailyVolume", () => {
        it("includes only from filter when to is missing", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { queryCalls } = mockClient(ch);
            await ch.getDailyVolume({ eventType: "created", from: "2024-03-01" });
            expect(queryCalls[0].query).to.include("date >= {from:Date}");
            expect(queryCalls[0].query).to.not.include("date <= {to:Date}");
            expect(queryCalls[0].params!.from).to.equal("2024-03-01");
        });

        it("includes only to filter when from is missing", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { queryCalls } = mockClient(ch);
            await ch.getDailyVolume({ eventType: "fulfilled", to: "2024-06-30" });
            expect(queryCalls[0].query).to.not.include("date >= {from:Date}");
            expect(queryCalls[0].query).to.include("date <= {to:Date}");
            expect(queryCalls[0].params!.to).to.equal("2024-06-30");
        });

        it("truncates date params to 10 chars", async () => {
            const ch = new Clickhouse("http://localhost:8123");
            const { queryCalls } = mockClient(ch);
            await ch.getDailyVolume({ eventType: "created", from: "2024-01-01T00:00:00Z", to: "2024-12-31T23:59:59Z" });
            expect(queryCalls[0].params!.from).to.equal("2024-01-01");
            expect(queryCalls[0].params!.to).to.equal("2024-12-31");
        });
    });
});
