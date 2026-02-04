import { describe, it } from "mocha";
import { expect } from "chai";
import {
  calculateUsdValue,
  decodeAmountBytes,
  tokenBytesToMint,
} from "../src/price";

describe("Price utilities", () => {
  describe("decodeAmountBytes", () => {
    it("decodes big-endian single trailing byte", () => {
      const bytes = [...Array.from({ length: 31 }, () => 0), 42];
      expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(42));
    });

    it("decodes little-endian single leading byte", () => {
      const bytes = [42, ...Array.from({ length: 31 }, () => 0)];
      expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(42));
    });

    it("decodes big-endian multi-byte (0x01 0x00 = 256)", () => {
      const bytes = [...Array.from({ length: 30 }, () => 0), 1, 0];
      expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(256));
    });

    it("decodes little-endian multi-byte (0x00 0x01 in LE = 256)", () => {
      const bytes = [0, 1, ...Array.from({ length: 30 }, () => 0)];
      expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(256));
    });

    it("decodes zero bytes", () => {
      const bytes = Array.from({ length: 32 }, () => 0);
      expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(0));
      expect(decodeAmountBytes(bytes, "little")).to.equal(BigInt(0));
    });

    it("handles empty array", () => {
      expect(decodeAmountBytes([], "big")).to.equal(BigInt(0));
      expect(decodeAmountBytes([], "little")).to.equal(BigInt(0));
    });

    it("decodes large 256-bit value correctly", () => {
      // Max uint256: all 0xFF bytes
      const bytes = Array.from({ length: 32 }, () => 0xff);
      const maxUint256 = (BigInt(1) << BigInt(256)) - BigInt(1);
      expect(decodeAmountBytes(bytes, "big")).to.equal(maxUint256);
    });

    it("big-endian and little-endian differ for asymmetric input", () => {
      // [1, 0, 0, ...] - BE=very large, LE=1
      const bytes = [1, ...Array.from({ length: 31 }, () => 0)];
      const be = decodeAmountBytes(bytes, "big");
      const le = decodeAmountBytes(bytes, "little");
      expect(le).to.equal(BigInt(1));
      expect(be).to.not.equal(le);
      // BE: 1 << 248
      expect(be).to.equal(BigInt(1) << BigInt(248));
    });

    it("decodes a realistic USDC amount (1000 USDC = 1_000_000_000 raw)", () => {
      // 1_000_000_000 = 0x3B9ACA00
      const bytes = Array.from({ length: 32 }, () => 0);
      bytes[28] = 0x3b;
      bytes[29] = 0x9a;
      bytes[30] = 0xca;
      bytes[31] = 0x00;
      expect(decodeAmountBytes(bytes, "big")).to.equal(BigInt(1_000_000_000));
    });
  });

  describe("calculateUsdValue", () => {
    it("returns 0 for zero amount", () => {
      expect(calculateUsdValue(BigInt(0), 6, 1.5)).to.equal(0);
    });

    it("handles 6-decimal token (1 USDC at $1)", () => {
      expect(calculateUsdValue(BigInt(1_000_000), 6, 1)).to.equal(1);
    });

    it("handles 9-decimal token (1 SOL at $150)", () => {
      expect(calculateUsdValue(BigInt(1_000_000_000), 9, 150)).to.equal(150);
    });

    it("handles fractional amounts (0.5 tokens at $2 = $1)", () => {
      expect(calculateUsdValue(BigInt(500_000), 6, 2)).to.equal(1);
    });

    it("handles 0 decimals", () => {
      expect(calculateUsdValue(BigInt(5), 0, 10)).to.equal(50);
    });

    it("handles large amounts (1M USDC)", () => {
      const result = calculateUsdValue(BigInt(1_000_000_000_000), 6, 1);
      expect(result).to.equal(1_000_000);
    });

    it("handles 18-decimal EVM-style token", () => {
      // 1 ETH = 1e18 wei at $3000
      const amount = BigInt("1000000000000000000");
      const result = calculateUsdValue(amount, 18, 3000);
      expect(result).to.equal(3000);
    });

    it("handles very small price (micro-cap token)", () => {
      // 1M tokens at $0.000001
      const result = calculateUsdValue(BigInt(1_000_000_000_000), 6, 0.000001);
      expect(result).to.be.closeTo(0.000001 * 1_000_000, 1e-10);
    });

    it("handles price of $0", () => {
      expect(calculateUsdValue(BigInt(1_000_000), 6, 0)).to.equal(0);
    });

    it("preserves fractional precision", () => {
      // 1.5 USDC at $1 = $1.5
      const result = calculateUsdValue(BigInt(1_500_000), 6, 1);
      expect(result).to.equal(1.5);
    });
  });

  describe("tokenBytesToMint", () => {
    it("converts 32 zero bytes to system program address", () => {
      const bytes = Array.from({ length: 32 }, () => 0);
      expect(tokenBytesToMint(bytes)).to.equal(
        "11111111111111111111111111111111",
      );
    });

    it("returns null for wrong-length arrays", () => {
      expect(tokenBytesToMint([])).to.equal(null);
      expect(tokenBytesToMint([1, 2, 3])).to.equal(null);
      expect(tokenBytesToMint(Array.from({ length: 31 }, () => 0))).to.equal(
        null,
      );
      expect(tokenBytesToMint(Array.from({ length: 33 }, () => 0))).to.equal(
        null,
      );
    });

    it("produces a valid base58 string for arbitrary 32 bytes", () => {
      const bytes = Array.from({ length: 32 }, (_, i) => i);
      const result = tokenBytesToMint(bytes);
      expect(result).to.be.a("string");
      expect(result!.length).to.be.greaterThan(0);
      // Base58 alphabet check
      expect(result).to.match(/^[1-9A-HJ-NP-Za-km-z]+$/);
    });

    it("returns deterministic output for same input", () => {
      const bytes = Array.from({ length: 32 }, (_, i) => i + 100);
      const a = tokenBytesToMint(bytes);
      const b = tokenBytesToMint(bytes);
      expect(a).to.equal(b);
    });
  });
});
