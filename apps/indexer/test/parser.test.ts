import { describe, it } from "mocha";
import { expect } from "chai";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { config } from "@dln/shared";
import {
  extractCreatedOrderData,
  extractCreatedOrderId,
  extractFulfilledOrderId,
  parseProgramEvents,
} from "../src/parser";
import type { CreatedOrderData } from "../src/parser";

class BorshWriter {
  private readonly chunks: Buffer[] = [];

  writeU8(value: number): void {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    this.chunks.push(buffer);
  }

  writeU32(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value, 0);
    this.chunks.push(buffer);
  }

  writeU64(value: bigint): void {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value, 0);
    this.chunks.push(buffer);
  }

  writeFixedBytes(bytes: number[]): void {
    this.chunks.push(Buffer.from(bytes));
  }

  writeBytes(bytes: number[]): void {
    this.writeU32(bytes.length);
    this.writeFixedBytes(bytes);
  }

  writeOption<T>(value: T | null, writeValue: (innerValue: T) => void): void {
    if (value === null) {
      this.writeU8(0);
      return;
    }
    this.writeU8(1);
    writeValue(value);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function eventDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
}

function buildProgramLogs(programId: PublicKey, base64Event: string): string[] {
  return [
    `Program ${programId.toString()} invoke [1]`,
    `Program data: ${base64Event}`,
    `Program ${programId.toString()} success`,
  ];
}

function encodeEvent(eventName: string, payload: Buffer): string {
  return Buffer.concat([eventDiscriminator(eventName), payload]).toString(
    "base64",
  );
}

function encodeOffer(
  writer: BorshWriter,
  offer: CreatedOrderData["order"]["give"],
): void {
  writer.writeFixedBytes(offer.chainId);
  writer.writeBytes(offer.tokenAddress);
  writer.writeFixedBytes(offer.amount);
}

function encodeCreatedOrderPayload(data: CreatedOrderData): Buffer {
  const writer = new BorshWriter();
  writer.writeU64(data.order.makerOrderNonce);
  writer.writeBytes(data.order.makerSrc);
  encodeOffer(writer, data.order.give);
  encodeOffer(writer, data.order.take);
  writer.writeBytes(data.order.receiverDst);
  writer.writeBytes(data.order.givePatchAuthoritySrc);
  writer.writeBytes(data.order.orderAuthorityAddressDst);
  writer.writeOption(data.order.allowedTakerDst, (value) =>
    writer.writeBytes(value),
  );
  writer.writeOption(data.order.allowedCancelBeneficiarySrc, (value) =>
    writer.writeBytes(value),
  );
  writer.writeOption(data.order.externalCall, (value) =>
    writer.writeFixedBytes(value.externalCallShortcut),
  );
  writer.writeU64(data.fixFee);
  writer.writeU64(data.percentFee);
  return writer.toBuffer();
}

function encodeCreatedOrderIdPayload(orderId: number[]): Buffer {
  const writer = new BorshWriter();
  writer.writeFixedBytes(orderId);
  return writer.toBuffer();
}

function encodeFulfilledPayload(orderId: number[], taker: number[]): Buffer {
  const writer = new BorshWriter();
  writer.writeFixedBytes(orderId);
  writer.writeFixedBytes(taker);
  return writer.toBuffer();
}

describe("Low-level log parsing", () => {
  it("extracts CreatedOrderId from src logs", () => {
    const programId = new PublicKey(config.dln.srcProgramId);
    const orderIdBytes = Array.from(
      { length: 32 },
      (_, index) => (index + 1) % 256,
    );
    const base64Event = encodeEvent(
      "CreatedOrderId",
      encodeCreatedOrderIdPayload(orderIdBytes),
    );
    const logs = buildProgramLogs(programId, base64Event);
    const events = parseProgramEvents(logs, programId.toString());
    const orderId = extractCreatedOrderId(events);
    expect(orderId).to.equal(Buffer.from(orderIdBytes).toString("hex"));
  });

  it("extracts Fulfilled orderId from dst logs", () => {
    const programId = new PublicKey(config.dln.dstProgramId);
    const orderIdBytes = Array.from(
      { length: 32 },
      (_, index) => (255 - index) % 256,
    );
    const takerBytes = Array.from({ length: 32 }, () => 11);
    const base64Event = encodeEvent(
      "Fulfilled",
      encodeFulfilledPayload(orderIdBytes, takerBytes),
    );
    const logs = buildProgramLogs(programId, base64Event);
    const events = parseProgramEvents(logs, programId.toString());
    const orderId = extractFulfilledOrderId(events);
    expect(orderId).to.equal(Buffer.from(orderIdBytes).toString("hex"));
  });

  it("parses CreatedOrder event payload", () => {
    const programId = new PublicKey(config.dln.srcProgramId);
    const giveToken = Array.from(
      { length: 32 },
      (_, index) => (index + 3) % 256,
    );
    const giveAmount = Array.from(
      { length: 32 },
      (_, index) => (index + 5) % 256,
    );
    const takeToken = Array.from(
      { length: 32 },
      (_, index) => (index + 7) % 256,
    );
    const takeAmount = Array.from(
      { length: 32 },
      (_, index) => (index + 9) % 256,
    );
    const payload: CreatedOrderData = {
      order: {
        makerOrderNonce: 42n,
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
        receiverDst: Array.from(
          { length: 32 },
          (_, index) => (index + 13) % 256,
        ),
        givePatchAuthoritySrc: Array.from(
          { length: 32 },
          (_, index) => (index + 15) % 256,
        ),
        orderAuthorityAddressDst: Array.from(
          { length: 32 },
          (_, index) => (index + 17) % 256,
        ),
        allowedTakerDst: null,
        allowedCancelBeneficiarySrc: null,
        externalCall: null,
      },
      fixFee: 7n,
      percentFee: 3n,
    };
    const base64Event = encodeEvent(
      "CreatedOrder",
      encodeCreatedOrderPayload(payload),
    );
    const logs = buildProgramLogs(programId, base64Event);
    const events = parseProgramEvents(logs, programId.toString());
    const data = extractCreatedOrderData(events);

    expect(data).to.not.equal(null);
    expect(data?.order.makerOrderNonce).to.equal(42n);
    expect(data?.order.give.tokenAddress).to.deep.equal(giveToken);
    expect(data?.order.give.amount).to.deep.equal(giveAmount);
    expect(data?.order.take.tokenAddress).to.deep.equal(takeToken);
    expect(data?.order.take.amount).to.deep.equal(takeAmount);
    expect(data?.fixFee).to.equal(7n);
    expect(data?.percentFee).to.equal(3n);
  });

  it("keeps only logs emitted by the target program", () => {
    const targetProgramId = new PublicKey(config.dln.srcProgramId);
    const foreignProgramId = new PublicKey(config.dln.dstProgramId);
    const foreignOrderId = Array.from({ length: 32 }, () => 170);
    const targetOrderId = Array.from({ length: 32 }, () => 187);
    const foreignEvent = encodeEvent(
      "CreatedOrderId",
      encodeCreatedOrderIdPayload(foreignOrderId),
    );
    const targetEvent = encodeEvent(
      "CreatedOrderId",
      encodeCreatedOrderIdPayload(targetOrderId),
    );
    const logs = [
      `Program ${foreignProgramId.toString()} invoke [1]`,
      `Program data: ${foreignEvent}`,
      `Program ${foreignProgramId.toString()} success`,
      `Program ${targetProgramId.toString()} invoke [1]`,
      `Program data: ${targetEvent}`,
      `Program ${targetProgramId.toString()} success`,
    ];

    const events = parseProgramEvents(logs, targetProgramId.toString());

    expect(events).to.have.length(1);
    expect(extractCreatedOrderId(events)).to.equal(
      Buffer.from(targetOrderId).toString("hex"),
    );
  });
});
