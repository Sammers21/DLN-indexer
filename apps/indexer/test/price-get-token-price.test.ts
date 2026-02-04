import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";

// Set Jupiter API key before any imports to avoid 'API key not configured' warning
process.env.JUPITER_API_KEY = "test-api-key";

const originalFetch = globalThis.fetch;

describe("getTokenPrice", () => {
  let getTokenPrice: (mint: string) => Promise<number | null>;
  let setPriceCache: (redis: unknown) => void;

  beforeEach(async () => {
    // Re-import to get fresh module with API key set
    const mod = await import("../src/price.js");
    getTokenPrice = mod.getTokenPrice;
    setPriceCache = mod.setPriceCache;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns price from Jupiter API on success", async () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ [mint]: { usdPrice: 1.0001 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const price = await getTokenPrice(mint);
    expect(price).to.equal(1.0001);
  });

  it("returns null when Jupiter returns non-ok status", async () => {
    globalThis.fetch = async () => new Response("Error", { status: 500 });
    const price = await getTokenPrice(
      "SomeMint111111111111111111111111111111111",
    );
    expect(price).to.equal(null);
  });

  it("returns null when Jupiter returns no data for mint", async () => {
    const mint = "UnknownMint1111111111111111111111111111111";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const price = await getTokenPrice(mint);
    expect(price).to.equal(null);
  });

  it("retries on 429 rate limit", async () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return new Response(JSON.stringify({ [mint]: { usdPrice: 150.5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const price = await getTokenPrice(mint);
    expect(price).to.equal(150.5);
    expect(callCount).to.equal(2);
  });

  it("retries on network error and eventually returns null", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network failure");
    };
    const price = await getTokenPrice(
      "SomeMint111111111111111111111111111111111",
    );
    expect(price).to.equal(null);
  });

  it("returns cached price from Redis when available", async () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const mockRedis = {
      getCachedPrice: async (key: string) => {
        if (key === `solana:${mint}`) return 99.99;
        return null;
      },
      setCachedPrice: async () => { },
      getCachedDecimals: async () => null,
      setCachedDecimals: async () => { },
    };
    setPriceCache(mockRedis as never);
    // fetch should not be called
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("", { status: 500 });
    };
    const price = await getTokenPrice(mint);
    expect(price).to.equal(99.99);
    expect(fetchCalled).to.equal(false);
    // Clean up - unset redis cache
    setPriceCache(null as never);
  });

  it("caches price in Redis after fetching from Jupiter", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    let cachedKey = "";
    let cachedPrice = 0;
    const mockRedis = {
      getCachedPrice: async () => null,
      setCachedPrice: async (key: string, price: number) => {
        cachedKey = key;
        cachedPrice = price;
      },
      getCachedDecimals: async () => null,
      setCachedDecimals: async () => { },
    };
    setPriceCache(mockRedis as never);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ [mint]: { usdPrice: 200.5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const price = await getTokenPrice(mint);
    expect(price).to.equal(200.5);
    expect(cachedKey).to.equal(`solana:${mint}`);
    expect(cachedPrice).to.equal(200.5);
    setPriceCache(null as never);
  });
});

describe("getTokenDecimals", () => {
  let getTokenDecimals: (mint: string) => Promise<number | null>;
  let setPriceCache: (redis: unknown) => void;

  beforeEach(async () => {
    const mod = await import("../src/price.js");
    getTokenDecimals = mod.getTokenDecimals;
    setPriceCache = mod.setPriceCache;
  });

  it("returns known decimals for SOL", async () => {
    const decimals = await getTokenDecimals(
      "So11111111111111111111111111111111111111112",
    );
    expect(decimals).to.equal(9);
  });

  it("returns known decimals for USDT", async () => {
    const decimals = await getTokenDecimals(
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    );
    expect(decimals).to.equal(6);
  });

  it("returns known decimals for BONK", async () => {
    const decimals = await getTokenDecimals(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    );
    expect(decimals).to.equal(5);
  });

  it("returns known decimals for JUP", async () => {
    const decimals = await getTokenDecimals(
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    );
    expect(decimals).to.equal(6);
  });

  it("returns cached decimals from Redis", async () => {
    const mint = "CustomMint11111111111111111111111111111111";
    const mockRedis = {
      getCachedPrice: async () => null,
      setCachedPrice: async () => { },
      getCachedDecimals: async (key: string) => {
        if (key === `solana:${mint}`) return 8;
        return null;
      },
      setCachedDecimals: async () => { },
    };
    setPriceCache(mockRedis as never);
    const decimals = await getTokenDecimals(mint);
    expect(decimals).to.equal(8);
    setPriceCache(null as never);
  });
});

describe("getUsdValue", () => {
  let getUsdValue: (
    tokenBytes: number[],
    amountBytes: number[],
  ) => Promise<number>;

  beforeEach(async () => {
    const mod = await import("../src/price.js");
    getUsdValue = mod.getUsdValue;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 0 for invalid token bytes", async () => {
    const value = await getUsdValue([1, 2, 3], [0]);
    expect(value).to.equal(0);
  });

  it("returns 0 for zero amount", async () => {
    const tokenBytes = Array.from({ length: 32 }, () => 0);
    const amountBytes = Array.from({ length: 32 }, () => 0);
    const value = await getUsdValue(tokenBytes, amountBytes);
    expect(value).to.equal(0);
  });

  it("returns 0 when no price available", async () => {
    // Use a valid 32-byte token that won't have a price
    const tokenBytes = Array.from({ length: 32 }, (_, i) => i + 1);
    const amountBytes = [...Array.from({ length: 31 }, () => 0), 100];
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const value = await getUsdValue(tokenBytes, amountBytes);
    expect(value).to.equal(0);
  });
});

describe("setPriceCache", () => {
  it("accepts a redis client without error", async () => {
    const mod = await import("../src/price.js");
    const mockRedis = {
      getCachedPrice: async () => null,
      setCachedPrice: async () => { },
      getCachedDecimals: async () => null,
      setCachedDecimals: async () => { },
    };
    // Should not throw
    mod.setPriceCache(mockRedis as never);
    mod.setPriceCache(null as never);
  });
});
