import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

// Try to load .env from various locations (monorepo root first)
const envPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", "..", ".env"),
  resolve(process.cwd(), "..", ".env"),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    break;
  }
}

// Disable proxy for all requests
process.env.NO_PROXY = process.env.NO_PROXY || "*";
process.env.no_proxy = process.env.no_proxy || "*";

export const config = {
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    rps: parseInt(process.env.SOLANA_RPS || "10", 10),
  },
  clickhouse: {
    host: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
    database: process.env.CLICKHOUSE_DATABASE || "dln",
    username: process.env.CLICKHOUSE_USER || "dln_admin",
    password: process.env.CLICKHOUSE_PASSWORD || "G6lxIxGvddWE5eTJ",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://:hTcBzuRpphtxJczJ@localhost:6379",
  },
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
    host: process.env.API_HOST || "0.0.0.0",
  },
  indexer: {
    batchSize: parseInt(process.env.INDEXER_BATCH_SIZE || "50", 10),
    delayMs: parseInt(process.env.INDEXER_DELAY_MS || "10000", 10),
  },
  dln: {
    srcProgramId: "src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4",
    dstProgramId: "dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo",
  },
  jupiter: {
    apiKey: process.env.JUPITER_API_KEY || "",
  },
} as const;
