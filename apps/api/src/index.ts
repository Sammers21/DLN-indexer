import { Hono } from "hono";
import { config, createLogger, Clickhouse } from "@dln/shared";
import type { OrderEventType } from "@dln/shared";

const logger = createLogger("api");
const clickhouse = new Clickhouse();
const app = new Hono();

const volumeKinds: Record<string, OrderEventType> = {
    fulfilled: "fulfilled",
    createOrder: "created",
};

// API routes
app.get("/api/default_range", async (c) => {
    const range = await clickhouse.getDefaultRange();
    return c.json(range);
});

app.get("/api/volume/:kind", async (c) => {
    const kind = c.req.param("kind");
    const eventType = volumeKinds[kind];
    if (!eventType) return c.json({ error: "Invalid volume kind" }, 400);
    const from = c.req.query("from");
    const to = c.req.query("to");
    const volumes = await clickhouse.getDailyVolume({ eventType, from, to });
    return c.json(volumes);
});

// Start server
const port = config.api.port;
logger.info({ port }, "API server starting");
export default {
    port,
    fetch: app.fetch,
};
