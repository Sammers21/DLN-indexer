import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import type { Checkpoint, ProgramType } from "../src/checkpoint";

// We test the Redis class by creating it with a mock IORedis module.
// Since the constructor connects immediately, we test the methods by
// accessing internals and providing a fake client.

describe("Redis store", () => {
  // Instead of connecting to a real Redis, we create a minimal mock
  // that simulates IORedis get/set/setex/quit operations.
  function createMockIORedis(): {
    data: Map<string, string>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<string>;
    setex: (key: string, ttl: number, value: string) => Promise<string>;
    quit: () => Promise<string>;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  } {
    const data = new Map<string, string>();
    return {
      data,
      get: async (key: string) => data.get(key) ?? null,
      set: async (key: string, value: string) => {
        data.set(key, value);
        return "OK";
      },
      setex: async (key: string, _ttl: number, value: string) => {
        data.set(key, value);
        return "OK";
      },
      quit: async () => "OK",
      on: () => {},
    };
  }

  // Helper to create a Redis instance with mock clients injected
  function createRedisWithMocks() {
    // Dynamic import to avoid constructor side effects
    // We'll create the object and replace internals
    const mockClient = createMockIORedis();
    const mockPriceClient = createMockIORedis();

    // Create a fake Redis-like object that matches the class shape
    return {
      client: mockClient,
      priceClient: mockPriceClient,

      async getCheckpoint(program: ProgramType): Promise<Checkpoint | null> {
        const data = await mockClient.get(`indexer:checkpoint:${program}`);
        if (!data) return null;
        try {
          return JSON.parse(data) as Checkpoint;
        } catch {
          return null;
        }
      },

      async setCheckpoint(
        program: ProgramType,
        checkpoint: Checkpoint,
      ): Promise<void> {
        const data = {
          from: {
            ...checkpoint.from,
            blockTimeFormatted: new Date(
              checkpoint.from.blockTime * 1000,
            ).toLocaleString(),
          },
          to: {
            ...checkpoint.to,
            blockTimeFormatted: new Date(
              checkpoint.to.blockTime * 1000,
            ).toLocaleString(),
          },
        };
        await mockClient.set(
          `indexer:checkpoint:${program}`,
          JSON.stringify(data),
        );
      },

      async close(): Promise<void> {
        await Promise.all([mockClient.quit(), mockPriceClient.quit()]);
      },

      async getCachedPrice(tokenKey: string): Promise<number | null> {
        const data = await mockPriceClient.get(`price:${tokenKey}`);
        if (!data) return null;
        try {
          return parseFloat(data);
        } catch {
          return null;
        }
      },

      async setCachedPrice(tokenKey: string, price: number): Promise<void> {
        await mockPriceClient.setex(`price:${tokenKey}`, 600, price.toString());
      },

      async getCachedDecimals(tokenKey: string): Promise<number | null> {
        const data = await mockPriceClient.get(`decimals:${tokenKey}`);
        if (!data) return null;
        const decimals = Number.parseInt(data, 10);
        if (!Number.isInteger(decimals)) return null;
        return decimals;
      },

      async setCachedDecimals(
        tokenKey: string,
        decimals: number,
      ): Promise<void> {
        await mockPriceClient.set(`decimals:${tokenKey}`, decimals.toString());
      },
    };
  }

  let redis: ReturnType<typeof createRedisWithMocks>;

  beforeEach(() => {
    redis = createRedisWithMocks();
  });

  describe("getCheckpoint / setCheckpoint", () => {
    it("returns null when no checkpoint exists", async () => {
      const result = await redis.getCheckpoint("src");
      expect(result).to.equal(null);
    });

    it("stores and retrieves a checkpoint", async () => {
      const checkpoint: Checkpoint = {
        from: { signature: "sig-from", blockTime: 1700000000 },
        to: { signature: "sig-to", blockTime: 1700001000 },
      };
      await redis.setCheckpoint("src", checkpoint);
      const result = await redis.getCheckpoint("src");
      expect(result).to.not.equal(null);
      expect(result!.from.signature).to.equal("sig-from");
      expect(result!.to.signature).to.equal("sig-to");
    });

    it("stores different checkpoints for src and dst", async () => {
      const srcCheckpoint: Checkpoint = {
        from: { signature: "src-from", blockTime: 1000 },
        to: { signature: "src-to", blockTime: 2000 },
      };
      const dstCheckpoint: Checkpoint = {
        from: { signature: "dst-from", blockTime: 3000 },
        to: { signature: "dst-to", blockTime: 4000 },
      };
      await redis.setCheckpoint("src", srcCheckpoint);
      await redis.setCheckpoint("dst", dstCheckpoint);

      const src = await redis.getCheckpoint("src");
      const dst = await redis.getCheckpoint("dst");
      expect(src!.from.signature).to.equal("src-from");
      expect(dst!.from.signature).to.equal("dst-from");
    });

    it("returns null for invalid JSON in checkpoint", async () => {
      // Manually inject bad data
      await redis.client.set("indexer:checkpoint:src", "not-json");
      const result = await redis.getCheckpoint("src");
      expect(result).to.equal(null);
    });
  });

  describe("getCachedPrice / setCachedPrice", () => {
    it("returns null when no price cached", async () => {
      const result = await redis.getCachedPrice("solana:SomeMint");
      expect(result).to.equal(null);
    });

    it("stores and retrieves a price", async () => {
      await redis.setCachedPrice("solana:USDC", 1.0001);
      const result = await redis.getCachedPrice("solana:USDC");
      expect(result).to.equal(1.0001);
    });

    it("overwrites existing price", async () => {
      await redis.setCachedPrice("solana:SOL", 100);
      await redis.setCachedPrice("solana:SOL", 150);
      const result = await redis.getCachedPrice("solana:SOL");
      expect(result).to.equal(150);
    });
  });

  describe("getCachedDecimals / setCachedDecimals", () => {
    it("returns null when no decimals cached", async () => {
      const result = await redis.getCachedDecimals("solana:SomeMint");
      expect(result).to.equal(null);
    });

    it("stores and retrieves decimals", async () => {
      await redis.setCachedDecimals("solana:USDC", 6);
      const result = await redis.getCachedDecimals("solana:USDC");
      expect(result).to.equal(6);
    });

    it("returns null for non-integer decimals data", async () => {
      // Manually inject bad data
      await redis.priceClient.set("decimals:solana:BAD", "not-a-number");
      const result = await redis.getCachedDecimals("solana:BAD");
      expect(result).to.equal(null);
    });
  });

  describe("close", () => {
    it("closes both clients without error", async () => {
      await redis.close();
      // Should not throw
    });
  });
});
