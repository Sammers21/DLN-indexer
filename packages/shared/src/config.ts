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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
  return value;
}

function getEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  solana: {
    get rpcUrl() {
      return getEnvOrDefault(
        "SOLANA_RPC_URL",
        "https://api.mainnet-beta.solana.com",
      );
    },
    get rps() {
      return parseInt(getEnvOrDefault("SOLANA_RPS", "10"), 10);
    },
  },
  clickhouse: {
    get host() {
      return getEnvOrDefault("CLICKHOUSE_HOST", "http://localhost:8123");
    },
    get database() {
      return getEnvOrDefault("CLICKHOUSE_DATABASE", "dln");
    },
    get username() {
      return getEnvOrDefault("CLICKHOUSE_USER", "dln_admin");
    },
    get password() {
      return getEnvOrDefault("CLICKHOUSE_PASSWORD", "");
    },
  },
  redis: {
    get url() {
      return getEnvOrDefault("REDIS_URL", "redis://localhost:6379");
    },
  },
  api: {
    get port() {
      return parseInt(getEnvOrDefault("API_PORT", "3000"), 10);
    },
    get host() {
      return getEnvOrDefault("API_HOST", "0.0.0.0");
    },
  },
  indexer: {
    get batchSize() {
      return parseInt(getEnvOrDefault("INDEXER_BATCH_SIZE", "50"), 10);
    },
    get delayMs() {
      return parseInt(getEnvOrDefault("INDEXER_DELAY_MS", "10000"), 10);
    },
  },
  dln: {
    srcProgramId: "src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4",
    dstProgramId: "dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo",
  },
  jupiter: {
    get apiKey() {
      return getEnvOrDefault("JUPITER_API_KEY", "");
    },
  },
};
