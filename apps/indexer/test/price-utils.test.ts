import { describe, it } from "mocha";
import { expect } from "chai";
import {
  calculateUsdValue,
  decodeAmountBytes,
  getTokenDecimals,
} from "../src/price";

describe("Price utilities", () => {
  it("decodes big-endian amount bytes", () => {
    const amountBytes = Array.from({ length: 31 }, () => 0);
    amountBytes.push(42);
    const amount = decodeAmountBytes(amountBytes, "big");
    expect(amount).to.equal(BigInt(42));
  });
  it("returns known token decimals without RPC lookup", async () => {
    const decimals = await getTokenDecimals(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(decimals).to.equal(6);
  });
  it("applies decimals when calculating USD values", () => {
    const usdValue = calculateUsdValue(BigInt(1500000), 6, 2);
    expect(usdValue).to.equal(3);
  });
});
