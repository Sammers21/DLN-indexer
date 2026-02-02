import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { config, createLogger } from '@dln/shared';

const logger = createLogger('fetcher');

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl, {
      commitment: 'confirmed',
      fetch: (url, options) => {
        return fetch(url, {
          ...options,
          // @ts-ignore - Bun supports this option to bypass proxy
          proxy: undefined,
        });
      },
    });
    logger.info({ rpcUrl: config.solana.rpcUrl }, 'Solana connection initialized');
  }
  return connection;
}

export interface FetchSignaturesOptions {
  programId: string;
  before?: string;
  until?: string;
  limit?: number;
}

export async function fetchSignatures(
  options: FetchSignaturesOptions
): Promise<ConfirmedSignatureInfo[]> {
  const conn = getConnection();
  const programPubkey = new PublicKey(options.programId);
  const signatures = await conn.getSignaturesForAddress(programPubkey, {
    before: options.before,
    until: options.until,
    limit: options.limit || config.indexer.batchSize,
  });
  logger.debug(
    {
      programId: options.programId,
      count: signatures.length,
      before: options.before,
    },
    'Fetched signatures'
  );
  return signatures;
}

export async function fetchTransaction(
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  const conn = getConnection();
  const tx = await conn.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  return tx;
}

export async function fetchTransactions(
  signatures: string[]
): Promise<(ParsedTransactionWithMeta | null)[]> {
  if (signatures.length === 0) return [];
  const results: (ParsedTransactionWithMeta | null)[] = [];
  for (const sig of signatures) {
    const tx = await fetchTransactionWithRetry(sig);
    results.push(tx);
    await sleep(50);
  }
  logger.debug(
    {
      requested: signatures.length,
      received: results.filter(Boolean).length,
    },
    'Fetched transactions'
  );
  return results;
}

async function fetchTransactionWithRetry(
  signature: string,
  maxRetries = 5
): Promise<ParsedTransactionWithMeta | null> {
  const conn = getConnection();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const tx = await conn.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      return tx;
    } catch (err) {
      lastError = err as Error;
      const isRateLimit = (err as Error).message?.includes('429') ||
        (err as Error).message?.includes('Too many requests');
      if (isRateLimit) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30000);
        logger.warn(
          { attempt, backoffMs, signature: signature.slice(0, 16) },
          'Rate limited, backing off'
        );
        await sleep(backoffMs);
      } else {
        logger.error({ err, signature }, 'Failed to fetch transaction');
        break;
      }
    }
  }
  logger.error({ lastError, signature }, 'Max retries exceeded');
  return null;
}

export async function getCurrentSlot(): Promise<number> {
  const conn = getConnection();
  return conn.getSlot();
}

export async function getBlockTime(slot: number): Promise<number | null> {
  const conn = getConnection();
  return conn.getBlockTime(slot);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
