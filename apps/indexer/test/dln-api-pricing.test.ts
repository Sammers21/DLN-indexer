import { describe, it, afterEach } from "mocha";
import { expect } from "chai";

// Set Jupiter API key before any imports to avoid 'API key not configured' warning
process.env.JUPITER_API_KEY = "test-api-key";

const originalFetch = globalThis.fetch;

describe("DLN API pricing flow", () => {
  let getUsdValueFromDlnApi: (orderId: string) => Promise<{
    usdValue: number | null;
    pricingStatus: "ok" | "error";
    pricingError: string | null;
  }>;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries on 429 and eventually succeeds", async () => {
    const mod = await import("../src/dln-api.js");
    getUsdValueFromDlnApi = mod.getUsdValueFromDlnApi;

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      // Second call succeeds with a 404 (simpler than mocking the full flow)
      return new Response("Not Found", { status: 404 });
    };

    const result = await getUsdValueFromDlnApi("retry429test");
    // After retry, gets 404
    expect(result.pricingError).to.equal("order_not_found");
    expect(callCount).to.equal(2);
  });

  it("returns api_status error for 503 responses", async () => {
    const mod = await import("../src/dln-api.js");
    getUsdValueFromDlnApi = mod.getUsdValueFromDlnApi;

    globalThis.fetch = async () =>
      new Response("Service Unavailable", { status: 503 });

    const result = await getUsdValueFromDlnApi("srv503");
    expect(result.pricingStatus).to.equal("error");
    expect(result.pricingError).to.equal("api_status_503");
  });

  it("returns no_price when Jupiter returns no price", async () => {
    const mod = await import("../src/dln-api.js");
    getUsdValueFromDlnApi = mod.getUsdValueFromDlnApi;

    let callCount = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      callCount++;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("dln-api.debridge.finance")) {
        // DLN API success with Solana chain
        const body = {
          orderId: { stringValue: "0xabc" },
          takeOffer: {
            chainId: { bigIntegerValue: 7565164 },
            tokenAddress: {
              stringValue: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            },
            amount: { stringValue: "1000000" },
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("jup.ag")) {
        // Jupiter returns empty data (no price)
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await getUsdValueFromDlnApi("0xnoprice123");
    expect(result.pricingStatus).to.equal("error");
    expect(result.pricingError).to.equal("no_price");
  }).timeout(30000);

  it("maps native SOL to wrapped SOL for pricing", async () => {
    const mod = await import("../src/dln-api.js");
    getUsdValueFromDlnApi = mod.getUsdValueFromDlnApi;

    let jupiterMintQueried = "";
    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("dln-api.debridge.finance")) {
        const body = {
          orderId: { stringValue: "0xsol" },
          takeOffer: {
            chainId: { bigIntegerValue: 7565164 },
            tokenAddress: {
              // Native SOL address
              stringValue: "11111111111111111111111111111111",
            },
            amount: { stringValue: "1000000000" }, // 1 SOL
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("jup.ag")) {
        // Capture which mint was queried
        const u = new URL(url);
        jupiterMintQueried = u.searchParams.get("ids") ?? "";
        const wrappedSol = "So11111111111111111111111111111111111111112";
        return new Response(
          JSON.stringify({ [wrappedSol]: { usdPrice: 150.0 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await getUsdValueFromDlnApi("0xsolorder");
    // Should have queried Jupiter with wrapped SOL
    expect(jupiterMintQueried).to.equal(
      "So11111111111111111111111111111111111111112",
    );
    // Should have calculated USD value: 1 SOL * $150 = $150
    expect(result.pricingStatus).to.equal("ok");
    expect(result.usdValue).to.be.closeTo(150, 1);
  }).timeout(30000);
});
