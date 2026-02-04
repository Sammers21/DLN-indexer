// Set required env vars before imports to avoid requireEnv errors in CI
process.env.CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "test";

import { describe, it } from "mocha";
import { expect } from "chai";
import { Clickhouse } from "@dln/shared";
import { createApp } from "../src/index.js";

type MockClient = {
  query: (args: {
    query: string;
    query_params?: Record<string, string>;
    format: string;
  }) => Promise<{ json: () => Promise<unknown[]> }>;
  insert: (args: {
    table: string;
    values: unknown[];
    format: string;
  }) => Promise<void>;
};

function createMockClickhouse(): Clickhouse {
  const ch = new Clickhouse("http://localhost:8123");
  // Replace the real client with a mock that returns empty results
  (ch as unknown as { client: MockClient }).client = {
    query: async () => ({ json: async () => [] }),
    insert: async () => {},
  };
  return ch;
}

describe("API routes", () => {
  describe("GET /api/default_range", () => {
    it("returns date range from clickhouse", async () => {
      const ch = createMockClickhouse();
      (ch as unknown as { client: MockClient }).client.query = async () => ({
        json: async () => [
          { cnt: "500", min_date: "2024-01-15", max_date: "2024-12-20" },
        ],
      });
      const app = createApp(ch);
      const res = await app.request("/api/default_range");
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body).to.deep.equal({ from: "2024-01-15", to: "2024-12-20" });
    });

    it("returns empty strings when no data", async () => {
      const ch = createMockClickhouse();
      (ch as unknown as { client: MockClient }).client.query = async () => ({
        json: async () => [
          { cnt: "0", min_date: "1970-01-01", max_date: "1970-01-01" },
        ],
      });
      const app = createApp(ch);
      const res = await app.request("/api/default_range");
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body).to.deep.equal({ from: "", to: "" });
    });
  });

  describe("GET /api/volume/:kind", () => {
    it("returns daily volumes for fulfilled orders", async () => {
      const ch = createMockClickhouse();
      const volumes = [
        { period: "2024-01-01", order_count: 10, volume_usd: 5000 },
        { period: "2024-01-02", order_count: 15, volume_usd: 7500 },
      ];
      (ch as unknown as { client: MockClient }).client.query = async () => ({
        json: async () => volumes,
      });
      const app = createApp(ch);
      const res = await app.request("/api/volume/fulfilled");
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body).to.deep.equal(volumes);
    });

    it("returns daily volumes for createOrder", async () => {
      const ch = createMockClickhouse();
      let capturedParams: Record<string, string> | undefined;
      (ch as unknown as { client: MockClient }).client.query = async (args) => {
        capturedParams = args.query_params;
        return { json: async () => [] };
      };
      const app = createApp(ch);
      const res = await app.request("/api/volume/createOrder");
      expect(res.status).to.equal(200);
      expect(capturedParams?.eventType).to.equal("created");
    });

    it("returns 400 for invalid volume kind", async () => {
      const ch = createMockClickhouse();
      const app = createApp(ch);
      const res = await app.request("/api/volume/invalid");
      expect(res.status).to.equal(400);
      const body = await res.json();
      expect(body).to.deep.equal({ error: "Invalid volume kind" });
    });

    it("passes from/to query params to clickhouse", async () => {
      const ch = createMockClickhouse();
      let capturedParams: Record<string, string> | undefined;
      (ch as unknown as { client: MockClient }).client.query = async (args) => {
        capturedParams = args.query_params;
        return { json: async () => [] };
      };
      const app = createApp(ch);
      const res = await app.request(
        "/api/volume/fulfilled?from=2024-01-01&to=2024-06-30",
      );
      expect(res.status).to.equal(200);
      expect(capturedParams?.from).to.equal("2024-01-01");
      expect(capturedParams?.to).to.equal("2024-06-30");
    });

    it("works without from/to query params", async () => {
      const ch = createMockClickhouse();
      let capturedParams: Record<string, string> | undefined;
      (ch as unknown as { client: MockClient }).client.query = async (args) => {
        capturedParams = args.query_params;
        return { json: async () => [] };
      };
      const app = createApp(ch);
      const res = await app.request("/api/volume/fulfilled");
      expect(res.status).to.equal(200);
      // Only eventType should be present, no from/to
      expect(capturedParams?.eventType).to.equal("fulfilled");
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const ch = createMockClickhouse();
      const app = createApp(ch);
      const res = await app.request("/api/nonexistent");
      expect(res.status).to.equal(404);
    });
  });
});
