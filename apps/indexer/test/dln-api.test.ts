import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";

// We need to mock the global fetch and the imported modules.
// Since dln-api.ts uses `getTokenPrice`, `getTokenDecimals`, and `calculateUsdValue`
// from price.ts, and those require external services, we test the module's
// internal logic by testing the exported function with a mocked global fetch.

// Save original fetch
const originalFetch = globalThis.fetch;

describe("DLN API client", () => {
    // We'll dynamically import the module after setting up mocks
    let getUsdValueFromDlnApi: (orderId: string) => Promise<{
        usdValue: number | null;
        pricingStatus: "ok" | "error";
        pricingError: string | null;
    }>;

    beforeEach(async () => {
        // Re-import to get fresh module (relies on the actual module)
        const mod = await import("../src/dln-api.js");
        getUsdValueFromDlnApi = mod.getUsdValueFromDlnApi;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("returns order_not_found for 404 responses", async () => {
        globalThis.fetch = async () => new Response("Not Found", { status: 404 });
        const result = await getUsdValueFromDlnApi("abcd1234");
        expect(result.pricingStatus).to.equal("error");
        expect(result.pricingError).to.equal("order_not_found");
        expect(result.usdValue).to.equal(null);
    });

    it("returns not_solana when chainId is not Solana", async () => {
        const body = {
            orderId: { stringValue: "0xabcd" },
            takeOffer: {
                chainId: { bigIntegerValue: 1 }, // Ethereum, not Solana (7565164)
                tokenAddress: { stringValue: "0xtoken" },
                amount: { stringValue: "1000000" },
            },
        };
        globalThis.fetch = async () => new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
        const result = await getUsdValueFromDlnApi("abcd1234");
        expect(result.pricingStatus).to.equal("error");
        expect(result.pricingError).to.equal("not_solana");
    });

    it("returns ok with 0 usdValue when amount is zero", async () => {
        const body = {
            orderId: { stringValue: "0xabcd" },
            takeOffer: {
                chainId: { bigIntegerValue: 7565164 },
                tokenAddress: { stringValue: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
                amount: { stringValue: "0" },
            },
        };
        globalThis.fetch = async () => new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
        const result = await getUsdValueFromDlnApi("abcd1234");
        expect(result.pricingStatus).to.equal("ok");
        expect(result.usdValue).to.equal(0);
    });

    it("returns api_status error for non-404/429 error codes", async () => {
        globalThis.fetch = async () => new Response("Server Error", { status: 500 });
        const result = await getUsdValueFromDlnApi("abcd1234");
        expect(result.pricingStatus).to.equal("error");
        expect(result.pricingError).to.equal("api_status_500");
    });

    it("prepends 0x to orderId if missing", async () => {
        let requestedUrl = "";
        globalThis.fetch = async (input: string | URL | Request) => {
            requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            return new Response("Not Found", { status: 404 });
        };
        await getUsdValueFromDlnApi("deadbeef");
        expect(requestedUrl).to.include("0xdeadbeef");
    });

    it("does not double-prepend 0x", async () => {
        let requestedUrl = "";
        globalThis.fetch = async (input: string | URL | Request) => {
            requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
            return new Response("Not Found", { status: 404 });
        };
        await getUsdValueFromDlnApi("0xdeadbeef");
        expect(requestedUrl).to.include("/0xdeadbeef/");
        expect(requestedUrl).to.not.include("0x0xdeadbeef");
    });
});
