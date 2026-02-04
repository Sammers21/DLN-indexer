import { Hono } from "hono";
import { config, createLogger, Clickhouse } from "@dln/shared";
import type { OrderEventType } from "@dln/shared";
import { registry, httpRequestDuration, httpRequestsTotal } from "./metrics.js";

const logger = createLogger("api");

/**
 * Validate date string format (YYYY-MM-DD)
 */
function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

const volumeKinds: Record<string, OrderEventType> = {
  fulfilled: "fulfilled",
  createOrder: "created",
};

export function createApp(clickhouse: Clickhouse): Hono {
  const app = new Hono();

  // Metrics middleware
  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const duration = (performance.now() - start) / 1000;
    const route = c.req.routePath ?? c.req.path;
    const method = c.req.method;
    const statusCode = String(c.res.status);
    httpRequestDuration.observe(
      { method, route, status_code: statusCode },
      duration,
    );
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
  });

  app.get("/metrics", async (c) => {
    const metrics = await registry.metrics();
    return c.text(metrics, 200, {
      "Content-Type": registry.contentType,
    });
  });

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
    // Validate date parameters if provided
    if (from && !isValidDateString(from)) {
      return c.json(
        { error: "Invalid 'from' date format. Use YYYY-MM-DD" },
        400,
      );
    }
    if (to && !isValidDateString(to)) {
      return c.json({ error: "Invalid 'to' date format. Use YYYY-MM-DD" }, 400);
    }
    const volumes = await clickhouse.getDailyVolume({ eventType, from, to });
    return c.json(volumes);
  });

  return app;
}

// Start server
const clickhouse = new Clickhouse();
const app = createApp(clickhouse);
const port = config.api.port;
logger.info({ port }, "API server starting");
export default {
  port,
  fetch: app.fetch,
};
