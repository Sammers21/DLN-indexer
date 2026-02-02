import { describe, it } from "mocha";
import { expect } from "chai";
import { toHex, bytesToBigInt, bytesToChainId } from "../src/parser.js";

describe("Parser Utilities", () => {
  describe("toHex", () => {
    it("should convert Uint8Array to hex string", () => {
      const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(toHex(input)).to.equal("deadbeef");
    });
    it("should handle empty array", () => {
      expect(toHex(new Uint8Array([]))).to.equal("");
    });
    it("should handle number array", () => {
      const input = [0x01, 0x02, 0x03];
      expect(toHex(input)).to.equal("010203");
    });
  });
  describe("bytesToBigInt", () => {
    it("should convert bytes to bigint (little-endian)", () => {
      const input = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
      expect(bytesToBigInt(input)).to.equal(1n);
    });
    it("should handle larger numbers", () => {
      const input = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
      expect(bytesToBigInt(input)).to.equal(65535n);
    });
    it("should handle empty array", () => {
      expect(bytesToBigInt(new Uint8Array([]))).to.equal(0n);
    });
  });
  describe("bytesToChainId", () => {
    it("should convert chain ID bytes to string", () => {
      const input = new Uint8Array(32);
      input[0] = 0x6c;
      input[1] = 0x6f;
      input[2] = 0x73;
      expect(bytesToChainId(input)).to.equal("7565164");
    });
    it("should handle Ethereum chain ID (1)", () => {
      const input = new Uint8Array(32);
      input[0] = 0x01;
      expect(bytesToChainId(input)).to.equal("1");
    });
  });
});
