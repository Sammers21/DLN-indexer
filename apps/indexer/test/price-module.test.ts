import { describe, it } from "mocha";
import { expect } from "chai";
import { tokenBytesToMint, decodeAmountBytes, calculateUsdValue } from "../src/price";

describe("tokenBytesToMint", () => {
    it("converts 32-byte array to base58 public key", () => {
        // All zeros = "11111111111111111111111111111111" (system program)
        const bytes = Array.from({ length: 32 }, () => 0);
        expect(tokenBytesToMint(bytes)).to.equal("11111111111111111111111111111111");
    });
    it("returns null for wrong-length arrays", () => {
        expect(tokenBytesToMint([])).to.equal(null);
        expect(tokenBytesToMint([1, 2, 3])).to.equal(null);
        expect(tokenBytesToMint(Array.from({ length: 31 }, () => 0))).to.equal(null);
        expect(tokenBytesToMint(Array.from({ length: 33 }, () => 0))).to.equal(null);
    });
});

describe("decodeAmountBytes", () => {
    it("decodes big-endian single byte", () => {
        const bytes = [...Array.from({ length: 31 }, () => 0), 100];
        expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(100));
    });
    it("decodes little-endian single byte", () => {
        const bytes = [100, ...Array.from({ length: 31 }, () => 0)];
        expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(100));
    });
    it("decodes big-endian multi-byte value", () => {
        // 0x0100 = 256
        const bytes = [...Array.from({ length: 30 }, () => 0), 1, 0];
        expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(256));
    });
    it("decodes little-endian multi-byte value", () => {
        // 0x0001 in LE = [0, 1, 0...] = 256
        const bytes = [0, 1, ...Array.from({ length: 30 }, () => 0)];
        expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(256));
    });
    it("decodes zero", () => {
        const bytes = Array.from({ length: 32 }, () => 0);
        expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(0));
        expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(0));
    });
    it("handles empty array", () => {
        expect(decodeAmountBytes([], "big")).to.equal(BigInt(0));
        expect(decodeAmountBytes([], "little")).to.equal(BigInt(0));
    });
});

describe("calculateUsdValue", () => {
    it("returns 0 for zero amount", () => {
        expect(calculateUsdValue(BigInt(0), 6, 1.5)).to.equal(0);
    });
    it("handles 6-decimal USDC-like tokens", () => {
        // 1,000,000 raw = 1.0 USDC at $1 = $1
        expect(calculateUsdValue(BigInt(1_000_000), 6, 1)).to.equal(1);
    });
    it("handles 9-decimal SOL-like tokens", () => {
        // 1,000,000,000 raw = 1.0 SOL at $150 = $150
        expect(calculateUsdValue(BigInt(1_000_000_000), 9, 150)).to.equal(150);
    });
    it("handles fractional amounts", () => {
        // 500,000 raw at 6 decimals = 0.5 tokens at $2 = $1
        expect(calculateUsdValue(BigInt(500_000), 6, 2)).to.equal(1);
    });
    it("handles 0 decimals", () => {
        // 5 raw at 0 decimals at $10 = $50
        expect(calculateUsdValue(BigInt(5), 0, 10)).to.equal(50);
    });
    it("handles large amounts", () => {
        // 1,000,000 USDC (1e12 raw) at $1
        const result = calculateUsdValue(BigInt(1_000_000_000_000), 6, 1);
        expect(result).to.equal(1_000_000);
    });
});
