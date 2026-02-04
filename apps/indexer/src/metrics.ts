import { Registry, Counter, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const apiRequests = new Counter({
  name: "indexer_api_requests_total",
  help: "Total external API requests made by the indexer",
  labelNames: ["dest", "endpoint", "status"] as const,
  registers: [registry],
});
