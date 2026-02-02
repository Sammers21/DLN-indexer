import 'dotenv/config';

// Disable proxy for all requests
process.env.NO_PROXY = process.env.NO_PROXY || '*';
process.env.no_proxy = process.env.no_proxy || '*';

export const config = {
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  },
  clickhouse: {
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DATABASE || 'dln',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
    host: process.env.API_HOST || '0.0.0.0',
  },
  indexer: {
    batchSize: parseInt(process.env.INDEXER_BATCH_SIZE || '20', 10),
    delayMs: parseInt(process.env.INDEXER_DELAY_MS || '500', 10),
  },
  dln: {
    srcProgramId: 'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4',
    dstProgramId: 'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo',
  },
} as const;
