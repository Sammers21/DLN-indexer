import { Hono } from "hono";
import { config, createLogger, getOrders, getVolumes, getVolumeSummary, getDateRange } from "@dln/shared";
import type { VolumeInterval } from "@dln/shared";

const logger = createLogger("api");
const app = new Hono();

// API routes
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/api/date-range", async (c) => {
    const range = await getDateRange();
    return c.json(range);
});

app.get("/api/orders", async (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
    const eventType = c.req.query("event_type");
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");
    const { orders, total } = await getOrders({
        page,
        limit,
        eventType,
        startDate,
        endDate,
    });
    return c.json({ orders, total, page, limit });
});

app.get("/api/volumes/daily", async (c) => {
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");
    const interval = (c.req.query("interval") || "day") as VolumeInterval;
    const volumes = await getVolumes({ startDate, endDate, interval });
    const byPeriod = new Map<string, {
        period: string;
        created_volume: number;
        fulfilled_volume: number;
        created_count: number;
        fulfilled_count: number;
    }>();
    for (const vol of volumes) {
        const existing = byPeriod.get(vol.period) || {
            period: vol.period,
            created_volume: 0,
            fulfilled_volume: 0,
            created_count: 0,
            fulfilled_count: 0,
        };
        if (vol.event_type === "created") {
            existing.created_volume = vol.volume_usd;
            existing.created_count = vol.order_count;
        } else {
            existing.fulfilled_volume = vol.volume_usd;
            existing.fulfilled_count = vol.order_count;
        }
        byPeriod.set(vol.period, existing);
    }
    return c.json(Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period)));
});

app.get("/api/volumes/summary", async (c) => {
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");
    const summary = await getVolumeSummary({ startDate, endDate });
    return c.json(summary);
});

// Start server
const port = config.api.port;
logger.info({ port }, "API server starting");
export default {
    port,
    fetch: app.fetch,
};
