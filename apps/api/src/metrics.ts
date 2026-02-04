import { Registry, Histogram, Counter, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "api_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "api_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});
