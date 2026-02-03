import { describe, it } from "mocha";
import { expect } from "chai";
import { BorshCoder, BorshEventCoder, EventParser, eventDiscriminator } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { config, DLN_DST_IDL, DLN_SRC_IDL } from "@dln/shared";
import BN from "bn.js";
import { extractCreatedOrderId, extractFulfilledOrderId } from "../src/parser";

function buildProgramLogs(programId: PublicKey, base64Event: string): string[] {
    return [
        `Program ${programId.toString()} invoke [1]`,
        `Program data: ${base64Event}`,
        `Program ${programId.toString()} success`,
    ];
}

function encodeEvent(idl: unknown, eventName: string, data: Record<string, unknown>): string {
    const eventCoder = new BorshEventCoder(idl as never);
    const layouts = (eventCoder as unknown as { layouts: Map<string, { encode: (src: unknown, buffer: Buffer, offset?: number) => number }> }).layouts;
    const layout = layouts.get(eventName);
    if (!layout) throw new Error(`Missing layout for event ${eventName}`);
    const buffer = Buffer.alloc(2048);
    const span = layout.encode(data, buffer);
    const discriminator = eventDiscriminator(eventName);
    return Buffer.concat([Buffer.from(discriminator), buffer.slice(0, span)]).toString("base64");
}

describe("Log parsing", () => {
    it("extracts CreatedOrderId from src logs", () => {
        const programId = new PublicKey(config.dln.srcProgramId);
        const orderIdBytes = Array.from({ length: 32 }, (_, index) => (index + 1) % 256);
        const coder = new BorshCoder(DLN_SRC_IDL);
        const parser = new EventParser(programId, coder);
        const base64Event = encodeEvent(DLN_SRC_IDL, "CreatedOrderId", { orderId: orderIdBytes });
        const logs = buildProgramLogs(programId, base64Event);
        const events = Array.from(parser.parseLogs(logs));
        const orderId = extractCreatedOrderId(events);
        expect(orderId).to.equal(Buffer.from(orderIdBytes).toString("hex"));
    });
    it("extracts Fulfilled orderId from dst logs", () => {
        const programId = new PublicKey(config.dln.dstProgramId);
        const orderIdBytes = Array.from({ length: 32 }, (_, index) => (255 - index) % 256);
        const coder = new BorshCoder(DLN_DST_IDL);
        const parser = new EventParser(programId, coder);
        const base64Event = encodeEvent(DLN_DST_IDL, "Fulfilled", {
            orderId: orderIdBytes,
            taker: new PublicKey("11111111111111111111111111111111"),
        });
        const logs = buildProgramLogs(programId, base64Event);
        const events = Array.from(parser.parseLogs(logs));
        const orderId = extractFulfilledOrderId(events);
        expect(orderId).to.equal(Buffer.from(orderIdBytes).toString("hex"));
    });
    it("parses CreatedOrder event payload", () => {
        const programId = new PublicKey(config.dln.srcProgramId);
        const coder = new BorshCoder(DLN_SRC_IDL);
        const parser = new EventParser(programId, coder);
        const giveToken = Array.from({ length: 32 }, (_, index) => (index + 3) % 256);
        const giveAmount = Array.from({ length: 32 }, (_, index) => (index + 5) % 256);
        const takeToken = Array.from({ length: 32 }, (_, index) => (index + 7) % 256);
        const takeAmount = Array.from({ length: 32 }, (_, index) => (index + 9) % 256);
        const payload = {
            order: {
                makerOrderNonce: new BN(42),
                makerSrc: Array.from({ length: 32 }, (_, index) => (index + 11) % 256),
                give: {
                    chainId: Array.from({ length: 32 }, (_, index) => (index + 1) % 256),
                    tokenAddress: giveToken,
                    amount: giveAmount,
                },
                take: {
                    chainId: Array.from({ length: 32 }, (_, index) => (index + 2) % 256),
                    tokenAddress: takeToken,
                    amount: takeAmount,
                },
                receiverDst: Array.from({ length: 32 }, (_, index) => (index + 13) % 256),
                givePatchAuthoritySrc: Array.from({ length: 32 }, (_, index) => (index + 15) % 256),
                orderAuthorityAddressDst: Array.from({ length: 32 }, (_, index) => (index + 17) % 256),
                allowedTakerDst: null,
                allowedCancelBeneficiarySrc: null,
                externalCall: null,
            },
            fixFee: new BN(7),
            percentFee: new BN(3),
        };
        const base64Event = encodeEvent(DLN_SRC_IDL, "CreatedOrder", payload);
        const logs = buildProgramLogs(programId, base64Event);
        const events = Array.from(parser.parseLogs(logs));
        const createdEvent = events.find((event) => event.name === "CreatedOrder");
        expect(createdEvent).to.not.equal(undefined);
        const data = createdEvent?.data as {
            order: {
                makerOrderNonce: BN;
                give: { tokenAddress: Uint8Array; amount: number[] };
                take: { tokenAddress: Uint8Array; amount: number[] };
            };
            fixFee: BN;
            percentFee: BN;
        };
        expect(data.order.makerOrderNonce.toString()).to.equal("42");
        expect(Array.from(data.order.give.tokenAddress)).to.deep.equal(giveToken);
        expect(Array.from(data.order.give.amount)).to.deep.equal(giveAmount);
        expect(Array.from(data.order.take.tokenAddress)).to.deep.equal(takeToken);
        expect(Array.from(data.order.take.amount)).to.deep.equal(takeAmount);
        expect(data.fixFee.toString()).to.equal("7");
        expect(data.percentFee.toString()).to.equal("3");
    });
});
