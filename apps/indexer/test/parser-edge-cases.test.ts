import { describe, it } from "mocha";
import { expect } from "chai";
import { extractCreatedOrderId, extractFulfilledOrderId } from "../src/parser";
import type { ParsedEvent } from "../src/parser";

describe("Parser edge cases", () => {
    describe("extractCreatedOrderId", () => {
        it("returns null for empty event list", () => {
            expect(extractCreatedOrderId([])).to.equal(null);
        });
        it("returns null when no CreatedOrderId event exists", () => {
            const events: ParsedEvent[] = [
                { name: "Fulfilled", data: { orderId: Array.from({ length: 32 }, () => 1) } },
                { name: "SomeOtherEvent", data: {} },
            ];
            expect(extractCreatedOrderId(events)).to.equal(null);
        });
        it("returns null when orderId is missing from data", () => {
            const events: ParsedEvent[] = [
                { name: "CreatedOrderId", data: {} },
            ];
            expect(extractCreatedOrderId(events)).to.equal(null);
        });
        it("returns null when orderId has wrong length", () => {
            const events: ParsedEvent[] = [
                { name: "CreatedOrderId", data: { orderId: [1, 2, 3] } },
            ];
            expect(extractCreatedOrderId(events)).to.equal(null);
        });
        it("extracts orderId from first matching event", () => {
            const orderIdBytes = Array.from({ length: 32 }, (_, i) => i);
            const events: ParsedEvent[] = [
                { name: "SomeOtherEvent", data: {} },
                { name: "CreatedOrderId", data: { orderId: orderIdBytes } },
            ];
            expect(extractCreatedOrderId(events)).to.equal(Buffer.from(orderIdBytes).toString("hex"));
        });
    });

    describe("extractFulfilledOrderId", () => {
        it("returns null for empty event list", () => {
            expect(extractFulfilledOrderId([])).to.equal(null);
        });
        it("returns null when no Fulfilled event exists", () => {
            const events: ParsedEvent[] = [
                { name: "CreatedOrderId", data: { orderId: Array.from({ length: 32 }, () => 1) } },
            ];
            expect(extractFulfilledOrderId(events)).to.equal(null);
        });
        it("returns null when orderId is missing from data", () => {
            const events: ParsedEvent[] = [
                { name: "Fulfilled", data: {} },
            ];
            expect(extractFulfilledOrderId(events)).to.equal(null);
        });
        it("returns null when orderId has wrong length", () => {
            const events: ParsedEvent[] = [
                { name: "Fulfilled", data: { orderId: Array.from({ length: 16 }, () => 0) } },
            ];
            expect(extractFulfilledOrderId(events)).to.equal(null);
        });
        it("extracts orderId from matching event", () => {
            const orderIdBytes = Array.from({ length: 32 }, (_, i) => 255 - i);
            const events: ParsedEvent[] = [
                { name: "Fulfilled", data: { orderId: orderIdBytes } },
            ];
            expect(extractFulfilledOrderId(events)).to.equal(Buffer.from(orderIdBytes).toString("hex"));
        });
    });
});
