import { BorshCoder, EventParser } from '@coral-xyz/anchor';
import { ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import {
  config,
  createLogger,
  DLN_SRC_IDL,
  DLN_DST_IDL,
  type CreatedOrderEvent,
  type FulfilledEvent,
  type Order,
  type EventType,
} from '@dln/shared';

const logger = createLogger('parser');

const srcCoder = new BorshCoder(DLN_SRC_IDL);
const dstCoder = new BorshCoder(DLN_DST_IDL);

const srcEventParser = new EventParser(new PublicKey(config.dln.srcProgramId), srcCoder);
const dstEventParser = new EventParser(new PublicKey(config.dln.dstProgramId), dstCoder);

export function toHex(arr: Uint8Array | number[]): string {
  return Buffer.from(arr).toString('hex');
}

export function bytesToBigInt(bytes: Uint8Array | number[]): bigint {
  const hex = Buffer.from(bytes).reverse().toString('hex');
  return hex ? BigInt('0x' + hex) : 0n;
}

export function bytesToChainId(bytes: Uint8Array | number[]): string {
  const bigInt = bytesToBigInt(bytes);
  return bigInt.toString();
}

export function parseCreatedOrderEvents(
  tx: ParsedTransactionWithMeta
): { orderId: string; event: CreatedOrderEvent }[] {
  const results: { orderId: string; event: CreatedOrderEvent }[] = [];
  if (!tx.meta?.logMessages) return results;
  try {
    const events = srcEventParser.parseLogs(tx.meta.logMessages);
    let createdOrderEvent: CreatedOrderEvent | null = null;
    let orderId: string | null = null;
    for (const event of events) {
      if (event.name === 'CreatedOrder') {
        createdOrderEvent = event.data as unknown as CreatedOrderEvent;
      } else if (event.name === 'CreatedOrderId') {
        const data = event.data as { orderId: number[] };
        orderId = toHex(data.orderId);
      }
    }
    if (createdOrderEvent && orderId) {
      results.push({
        orderId,
        event: { ...createdOrderEvent, orderId },
      });
    }
  } catch (err) {
    logger.debug({ err, signature: tx.transaction.signatures[0] }, 'Failed to parse src events');
  }
  return results;
}

export function parseFulfilledEvents(
  tx: ParsedTransactionWithMeta
): { orderId: string; event: FulfilledEvent }[] {
  const results: { orderId: string; event: FulfilledEvent }[] = [];
  if (!tx.meta?.logMessages) return results;
  try {
    const events = dstEventParser.parseLogs(tx.meta.logMessages);
    for (const event of events) {
      if (event.name === 'Fulfilled') {
        const data = event.data as { orderId: number[]; taker: PublicKey };
        const orderId = toHex(data.orderId);
        results.push({
          orderId,
          event: {
            orderId,
            taker: data.taker.toBase58(),
          },
        });
      }
    }
  } catch (err) {
    logger.debug({ err, signature: tx.transaction.signatures[0] }, 'Failed to parse dst events');
  }
  return results;
}

export function createdEventToOrder(
  orderId: string,
  event: CreatedOrderEvent,
  tx: ParsedTransactionWithMeta
): Order {
  const order = event.order;
  return {
    order_id: orderId,
    event_type: 'created' as EventType,
    tx_signature: tx.transaction.signatures[0],
    slot: BigInt(tx.slot),
    block_time: new Date((tx.blockTime || 0) * 1000),
    give_chain_id: bytesToChainId(order.give.chainId),
    give_token_address: toHex(order.give.tokenAddress),
    give_amount: bytesToBigInt(order.give.amount),
    take_chain_id: bytesToChainId(order.take.chainId),
    take_token_address: toHex(order.take.tokenAddress),
    take_amount: bytesToBigInt(order.take.amount),
    maker: toHex(order.makerSrc),
  };
}

export function fulfilledEventToOrder(
  orderId: string,
  event: FulfilledEvent,
  tx: ParsedTransactionWithMeta
): Order {
  return {
    order_id: orderId,
    event_type: 'fulfilled' as EventType,
    tx_signature: tx.transaction.signatures[0],
    slot: BigInt(tx.slot),
    block_time: new Date((tx.blockTime || 0) * 1000),
    taker: event.taker,
  };
}

export function parseTransaction(tx: ParsedTransactionWithMeta): Order[] {
  const orders: Order[] = [];
  const createdEvents = parseCreatedOrderEvents(tx);
  for (const { orderId, event } of createdEvents) {
    orders.push(createdEventToOrder(orderId, event, tx));
  }
  const fulfilledEvents = parseFulfilledEvents(tx);
  for (const { orderId, event } of fulfilledEvents) {
    orders.push(fulfilledEventToOrder(orderId, event, tx));
  }
  return orders;
}
