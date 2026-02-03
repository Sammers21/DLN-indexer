import { describe, it } from "mocha";
import { expect } from "chai";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeAmountBytes } from "../src/price";

interface KnownOrderFixture {
    enabled: boolean;
    orderId?: string;
    amountBytes: number[];
    expectedAmount: string;
}

describe("DLN amount endianness", () => {
    it("decodes known order amounts as big-endian", function () {
        const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "known-order.json");
        if (!existsSync(fixturePath)) {
            this.skip();
            return;
        }
        const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as KnownOrderFixture;
        if (!fixture.enabled) {
            this.skip();
            return;
        }
        expect(fixture.amountBytes).to.have.length(32);
        const expected = BigInt(fixture.expectedAmount);
        const amountBig = decodeAmountBytes(fixture.amountBytes, "big");
        const amountLittle = decodeAmountBytes(fixture.amountBytes, "little");
        expect(amountBig).to.equal(expected);
        expect(amountLittle).to.not.equal(expected);
    });
});
