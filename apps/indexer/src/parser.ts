import { createHash } from "node:crypto";

const PROGRAM_LOG_PREFIX = "Program log: ";
const PROGRAM_DATA_PREFIX = "Program data: ";
const EVENT_DISCRIMINATOR_BYTES = 8;
const ORDER_ID_BYTES = 32;

export interface Offer {
  chainId: number[];
  tokenAddress: number[];
  amount: number[];
}

export interface DlnOrder {
  makerOrderNonce: bigint;
  makerSrc: number[];
  give: Offer;
  take: Offer;
  receiverDst: number[];
  givePatchAuthoritySrc: number[];
  orderAuthorityAddressDst: number[];
  allowedTakerDst: number[] | null;
  allowedCancelBeneficiarySrc: number[] | null;
  externalCall: { externalCallShortcut: number[] } | null;
}

export interface CreatedOrderData {
  order: DlnOrder;
  fixFee: bigint;
  percentFee: bigint;
}

export interface ParsedEvent<TData = unknown> {
  name: string;
  data: TData;
}

type EventDecoder = {
  name: string;
  decode: (payload: Buffer) => unknown;
};

const EVENT_DECODERS = new Map<string, EventDecoder>([
  [
    eventDiscriminator("CreatedOrder"),
    { name: "CreatedOrder", decode: decodeCreatedOrderPayload },
  ],
  [
    eventDiscriminator("CreatedOrderId"),
    { name: "CreatedOrderId", decode: decodeCreatedOrderIdPayload },
  ],
  [
    eventDiscriminator("Fulfilled"),
    { name: "Fulfilled", decode: decodeFulfilledPayload },
  ],
]);

class BorshReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  readU8(): number {
    this.ensureAvailable(1);
    const value = this.buffer[this.offset];
    this.offset += 1;
    return value;
  }

  readU32(): number {
    this.ensureAvailable(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readU64(): bigint {
    this.ensureAvailable(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readFixedBytes(length: number): number[] {
    this.ensureAvailable(length);
    const bytes = Array.from(
      this.buffer.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return bytes;
  }

  readBytes(): number[] {
    const length = this.readU32();
    return this.readFixedBytes(length);
  }

  readOption<T>(decodeValue: () => T): T | null {
    const flag = this.readU8();
    if (flag === 0) return null;
    if (flag === 1) return decodeValue();
    throw new Error(`Invalid option flag ${flag}`);
  }

  ensureFullyRead(): void {
    if (this.offset === this.buffer.length) return;
    throw new Error(
      `Unexpected trailing bytes: consumed=${this.offset} total=${this.buffer.length}`,
    );
  }

  private ensureAvailable(length: number): void {
    if (this.offset + length <= this.buffer.length) return;
    throw new Error(
      `Not enough bytes: requested=${length} offset=${this.offset} total=${this.buffer.length}`,
    );
  }
}

export function parseProgramEvents(
  logMessages: readonly string[],
  programId: string,
): ParsedEvent[] {
  const parsedEvents: ParsedEvent[] = [];
  const executionStack: string[] = [];

  for (const log of logMessages) {
    const invokedProgram = parseInvokedProgram(log);
    if (invokedProgram) {
      executionStack.push(invokedProgram);
      continue;
    }

    const completedProgram = parseCompletedProgram(log);
    if (completedProgram) {
      popExecutionFrame(executionStack, completedProgram);
      continue;
    }

    if (executionStack[executionStack.length - 1] !== programId) continue;
    const encodedData = extractProgramData(log);
    if (!encodedData) continue;
    const parsed = tryDecodeEvent(encodedData);
    if (parsed) parsedEvents.push(parsed);
  }

  return parsedEvents;
}

export function extractCreatedOrderData(
  eventsList: readonly ParsedEvent[],
): CreatedOrderData | null {
  for (const event of eventsList) {
    if (event.name !== "CreatedOrder") continue;
    return event.data as CreatedOrderData;
  }
  return null;
}

export function extractCreatedOrderId(
  eventsList: readonly ParsedEvent[],
): string | null {
  for (const event of eventsList) {
    if (event.name !== "CreatedOrderId") continue;
    const data = event.data as { orderId?: number[] };
    if (!data?.orderId || data.orderId.length !== ORDER_ID_BYTES) return null;
    return Buffer.from(data.orderId).toString("hex");
  }
  return null;
}

export function extractFulfilledOrderId(
  eventsList: readonly ParsedEvent[],
): string | null {
  for (const event of eventsList) {
    if (event.name !== "Fulfilled") continue;
    const data = event.data as { orderId?: number[] };
    if (!data?.orderId || data.orderId.length !== ORDER_ID_BYTES) return null;
    return Buffer.from(data.orderId).toString("hex");
  }
  return null;
}

function eventDiscriminator(eventName: string): string {
  const hash = createHash("sha256").update(`event:${eventName}`).digest();
  return hash.subarray(0, EVENT_DISCRIMINATOR_BYTES).toString("hex");
}

function parseInvokedProgram(log: string): string | null {
  const match = /^Program (\S+) invoke \[\d+\]$/.exec(log);
  return match ? match[1] : null;
}

function parseCompletedProgram(log: string): string | null {
  const successMatch = /^Program (\S+) success$/.exec(log);
  if (successMatch) return successMatch[1];
  const failedMatch = /^Program (\S+) failed: /.exec(log);
  if (failedMatch) return failedMatch[1];
  return null;
}

function popExecutionFrame(stack: string[], completedProgram: string): void {
  if (stack.length === 0) return;

  const top = stack[stack.length - 1];
  if (top === completedProgram) {
    stack.pop();
    return;
  }

  const index = stack.lastIndexOf(completedProgram);
  if (index >= 0) {
    stack.splice(index, 1);
    return;
  }

  stack.pop();
}

function extractProgramData(log: string): string | null {
  if (log.startsWith(PROGRAM_DATA_PREFIX)) {
    return log.slice(PROGRAM_DATA_PREFIX.length).trim();
  }
  if (log.startsWith(PROGRAM_LOG_PREFIX)) {
    return log.slice(PROGRAM_LOG_PREFIX.length).trim();
  }
  return null;
}

function tryDecodeEvent(encodedData: string): ParsedEvent | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(encodedData, "base64");
  } catch {
    return null;
  }

  if (raw.length <= EVENT_DISCRIMINATOR_BYTES) return null;

  const discriminator = raw
    .subarray(0, EVENT_DISCRIMINATOR_BYTES)
    .toString("hex");
  const decoder = EVENT_DECODERS.get(discriminator);
  if (!decoder) return null;

  try {
    return {
      name: decoder.name,
      data: decoder.decode(raw.subarray(EVENT_DISCRIMINATOR_BYTES)),
    };
  } catch {
    return null;
  }
}

function decodeCreatedOrderPayload(payload: Buffer): CreatedOrderData {
  const reader = new BorshReader(payload);
  const data: CreatedOrderData = {
    order: decodeOrder(reader),
    fixFee: reader.readU64(),
    percentFee: reader.readU64(),
  };
  reader.ensureFullyRead();
  return data;
}

function decodeCreatedOrderIdPayload(payload: Buffer): { orderId: number[] } {
  const reader = new BorshReader(payload);
  const data = { orderId: reader.readFixedBytes(ORDER_ID_BYTES) };
  reader.ensureFullyRead();
  return data;
}

function decodeFulfilledPayload(payload: Buffer): {
  orderId: number[];
  taker: number[];
} {
  const reader = new BorshReader(payload);
  const data = {
    orderId: reader.readFixedBytes(ORDER_ID_BYTES),
    taker: reader.readFixedBytes(ORDER_ID_BYTES),
  };
  reader.ensureFullyRead();
  return data;
}

function decodeOffer(reader: BorshReader): Offer {
  return {
    chainId: reader.readFixedBytes(ORDER_ID_BYTES),
    tokenAddress: reader.readBytes(),
    amount: reader.readFixedBytes(ORDER_ID_BYTES),
  };
}

function decodeOrder(reader: BorshReader): DlnOrder {
  return {
    makerOrderNonce: reader.readU64(),
    makerSrc: reader.readBytes(),
    give: decodeOffer(reader),
    take: decodeOffer(reader),
    receiverDst: reader.readBytes(),
    givePatchAuthoritySrc: reader.readBytes(),
    orderAuthorityAddressDst: reader.readBytes(),
    allowedTakerDst: reader.readOption(() => reader.readBytes()),
    allowedCancelBeneficiarySrc: reader.readOption(() => reader.readBytes()),
    externalCall: reader.readOption(() => ({
      externalCallShortcut: reader.readFixedBytes(ORDER_ID_BYTES),
    })),
  };
}
