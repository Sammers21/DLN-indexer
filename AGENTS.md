# DLN Indexer - Agent Guidelines

This document provides context for AI coding agents working on this project.

## Project Overview

DLN Indexer is a **Solana blockchain indexer** that tracks DLN (deBridge Liquidity Network) cross-chain order events. It consists of two applications in a Turborepo monorepo:

1. **Indexer** - Fetches and parses blockchain transactions
2. **Dashboard** - Hono API + React UI for querying and visualizing indexed data

## Technology Stack

| Layer    | Technology       | Notes                                            |
| -------- | ---------------- | ------------------------------------------------ |
| Runtime  | **Bun**          | Use `bun` for all commands, not `npm` or `yarn`  |
| Language | **TypeScript**   | ESM modules (`.js` extensions in imports)        |
| Database | **ClickHouse**   | Column-oriented OLAP database                    |
| Cache    | **Redis**        | db 0: Checkpoints, db 1: Price cache (10min TTL) |
| Pricing  | **Jupiter V3**   | API key required from portal.jup.ag              |
| Web      | **Hono**         | Lightweight web framework, serves API + static   |
| Frontend | **React + Vite** | With Recharts for charts                         |
| Testing  | **Mocha + Chai** | Test files in `test/` directories                |
| Monorepo | **Turborepo**    | Workspace management                             |

## Project Structure

```
dln-indexer/
├── apps/
│   ├── indexer/              # Blockchain indexer
│   │   ├── src/
│   │   │   ├── main.ts       # Entry point - orchestrates indexing
│   │   │   ├── indexer.ts    # Core Indexer class with bidirectional logic
│   │   │   ├── solana.ts     # Rate-limited Solana RPC client
│   │   │   ├── price.ts      # Jupiter V3 price fetching + Redis cache
│   │   │   ├── dln-api.ts    # DLN API for OrderFulfilled USD values
│   │   │   ├── analytics/    # Analytics interface & types
│   │   │   ├── checkpoint/   # Checkpoint interfaces
│   │   │   └── storage/      # Redis (checkpoint + prices) & ClickHouse
│   │   └── test/
│   └── dashboard/            # Hono + React dashboard
│       └── src/
│           ├── server/       # Hono API server
│           │   └── index.ts  # API routes + static file serving
│           └── client/       # React frontend
│               ├── App.tsx   # Dashboard UI
│               └── main.tsx  # React entry point
├── packages/
│   └── shared/               # Shared library (@dln/shared)
│       └── src/
│           ├── config.ts     # Environment configuration
│           ├── types.ts      # TypeScript interfaces
│           ├── services/     # ClickHouse, Redis, Price service
│           ├── utils/        # Logger (Pino)
│           └── idls/         # Anchor IDL definitions for DLN
├── infra/                    # Docker Compose for ClickHouse + Redis
├── package.json              # Root workspace config
├── turbo.json                # Turborepo tasks
└── bunfig.toml               # Bun configuration
```

## Key Concepts

### DLN Protocol

- **DLN Source** (`src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4`) - Emits `CreatedOrder` + `CreatedOrderId` events when users create cross-chain orders
- **DLN Destination** (`dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo`) - Emits `Fulfilled` events when orders are filled

### Event Parsing

- Uses Anchor's `BorshCoder` and `EventParser` to deserialize events from transaction logs
- IDLs are in `packages/shared/src/idls/` - these define the on-chain program structures
- For `OrderCreated`: Both `CreatedOrder` (contains token amounts) and `CreatedOrderId` (contains orderId) events are parsed from the same transaction
- USD value is calculated for `OrderCreated` using Jupiter Price API V3
- For `OrderFulfilled`: USD value fetched via DLN API (gets cross-chain order details) + Jupiter prices

### Price Fetching

- **Jupiter V3 API**: Requires API key from [portal.jup.ag](https://portal.jup.ag)
- **Redis Cache**: Prices cached in db 1 with 10-minute TTL
- **Flow**: Redis cache → Jupiter API → cache result
- **Tokens**: Supports any Solana SPL token that Jupiter supports

### Data Flow

```
Solana RPC → Indexer → Event Parser → ClickHouse (Analytics)
                            ↓
              ┌─────────────┴─────────────┐
              ↓                           ↓
      Redis db 0 (Checkpoint)    Redis db 1 (Price Cache)
                                          ↑
                                   Jupiter V3 API
                                          ↑
                              DLN API (for OrderFulfilled)
```

### Bidirectional Indexing

The indexer uses **interval-based checkpoints** with bidirectional indexing:

```typescript
interface Checkpoint {
  from: CheckpointBoundary; // oldest indexed signature
  to: CheckpointBoundary; // newest indexed signature
}

interface CheckpointBoundary {
  signature: string;
  blockTime: number;
}
```

**Indexing loop:**

1. Fetch new signatures after `checkpoint.to` (forward/upward)
2. Process them
3. If batch < batchSize, also fetch signatures before `checkpoint.from` (backward)
4. Process them

This ensures new transactions are prioritized while historical data is backfilled.

### Checkpointing

- Indexer stores checkpoint interval in Redis
- Key format: `indexer:checkpoint:src` or `indexer:checkpoint:dst`
- Checkpoint saved every 1 second (not per transaction)
- On restart, continues from both boundaries

## Development Commands

```bash
# Install dependencies
bun install

# Start infrastructure (ClickHouse + Redis)
cd infra && docker compose up -d

# Run apps
bun run indexer     # Start blockchain indexer
bun run dashboard   # Start dashboard (Vite dev + API proxy to port 3000)

# For production
cd apps/dashboard && bun run build && bun run start  # Hono server on port 3000

# Testing
bun run test        # Watch mode
bun run test:run    # Single run

# Type checking
bunx tsc --noEmit -p apps/indexer/tsconfig.json
bunx tsc --noEmit -p apps/dashboard/tsconfig.json
bunx tsc --noEmit -p packages/shared/tsconfig.json
```

## Import Conventions

### From shared package

```typescript
import { config, createLogger, type Order } from "@dln/shared";
import { DLN_SRC_IDL, DLN_DST_IDL } from "@dln/shared";
```

### Internal imports

```typescript
import { Indexer } from "./indexer";
import { SolanaClient } from "./solana";
import { Redis, Clickhouse } from "./storage";
```

## Database Schema

### ClickHouse Tables

- `orders` - Main table with `ReplacingMergeTree` engine (handles duplicates)
- `daily_volumes_mv` - Materialized view for pre-aggregated daily volumes

### Key Fields

```sql
order_id        String      -- Hex-encoded 32-byte order ID
event_type      String      -- 'created' or 'fulfilled'
tx_signature    String      -- Solana transaction signature
block_time      DateTime64  -- Transaction timestamp
usd_value       Float64     -- USD value (from Jupiter API, -1 for fulfilled)
```

## Indexer Architecture

### Key Classes

- **`Indexer`** (`indexer.ts`) - Core indexing logic
  - `startIndexing()` - Main loop with bidirectional fetching
  - `handleSignature()` - Process single transaction
  - `processOrderCreated()` - Parse and enrich with USD value via Jupiter
  - `processOrderFulfilled()` - Parse and enrich via DLN API + Jupiter
  - `updateCheckpoint()` - Update from/to boundaries

- **`SolanaClient`** (`solana.ts`) - Rate-limited RPC client
  - Uses `bottleneck` for rate limiting
  - Logs request time for each call

- **`Redis`** (`storage/redis.ts`) - Checkpoint + price cache
  - Implements `CheckpointStore` interface
  - db 0: Checkpoints
  - db 1: Price cache (10min TTL)

- **`Clickhouse`** (`storage/clickhouse.ts`) - Order storage
  - Implements `Analytics` interface

- **`price.ts`** - Jupiter V3 price fetching
  - `getTokenPrice(mint)` - Get price with Redis caching
  - `getTokenDecimals(mint)` - Get decimals for known tokens

- **`dln-api.ts`** - DLN API integration
  - `getUsdValueFromDlnApi(orderId)` - Get USD value for fulfilled orders
  - Fetches cross-chain order details, then uses Jupiter for Solana token price

### Interfaces

```typescript
// Checkpoint (apps/indexer/src/checkpoint/checkpoint.ts)
interface Checkpoint {
  from: CheckpointBoundary;
  to: CheckpointBoundary;
}

// Analytics (apps/indexer/src/analytics/analytics.ts)
interface Analytics {
  insertOrders(orders: Order[]): Promise<void>;
  getOrderCount(kind: OrderKind): Promise<number>;
}

// Order
interface Order {
  orderId: string;
  signature: string;
  time: number;
  usdValue: number;
  kind: OrderKind;
}
```

## API Endpoints (Hono)

| Endpoint                   | Description                |
| -------------------------- | -------------------------- |
| `GET /api/health`          | Health check               |
| `GET /api/orders`          | Paginated orders list      |
| `GET /api/volumes/daily`   | Daily volumes for charting |
| `GET /api/volumes/summary` | Aggregate statistics       |

## Environment Variables

Key variables (see `.env.example`):

- `SOLANA_RPC_URL` - Solana RPC endpoint (use paid provider for speed)
- `SOLANA_RPS` - Requests per second limit (default: 10)
- `CLICKHOUSE_HOST` - ClickHouse HTTP endpoint
- `REDIS_URL` - Redis connection string
- `JUPITER_API_KEY` - Jupiter V3 API key from [portal.jup.ag](https://portal.jup.ag)
- `INDEXER_BATCH_SIZE` - Signatures per batch (default: 5)
- `INDEXER_DELAY_MS` - Delay when no signatures (default: 10000ms)

## Common Tasks

### Adding a new API endpoint

1. Add route in `apps/dashboard/src/server/index.ts`
2. Add types to `packages/shared/src/types.ts` if needed

### Adding a new service

1. Create in `packages/shared/src/services/`
2. Export from `packages/shared/src/services/index.ts`
3. Export from `packages/shared/src/index.ts`

### Modifying database schema

1. Update `infra/init-db.sql`
2. Run `docker compose down -v && docker compose up -d` to recreate

### Resetting checkpoints

```bash
# Connect to Redis db 0 (checkpoints)
redis-cli -a <password>
DEL indexer:checkpoint:src
DEL indexer:checkpoint:dst
```

### Clearing price cache

```bash
# Connect to Redis db 1 (prices)
redis-cli -a <password> -n 1
FLUSHDB
```

## Testing Guidelines

- Tests use **Mocha + Chai**
- Test files go in `test/` directory with `.test.ts` suffix
- Run with `bun run test:run` in app directory or root

```typescript
import { describe, it } from "mocha";
import { expect } from "chai";

describe("Feature", () => {
  it("should work", () => {
    expect(true).to.be.true;
  });
});
```

## Code Style

- No empty lines inside function bodies
- Use `const` by default, `let` only when reassignment needed
- Explicit return types on exported functions
- Use Pino logger (`createLogger('module-name')`)

## Troubleshooting

### Rate limiting (429 errors)

- Decrease `INDEXER_BATCH_SIZE`
- Decrease `SOLANA_RPS`
- Use a paid RPC provider (Helius, QuickNode)

### Type errors with ClickHouse responses

- Use `as unknown as Type[]` pattern for JSON responses
- ClickHouse client returns objects that need casting

### IDL parsing errors

- Anchor 0.29.0 is required (newer versions have incompatible IDL format)
- Don't upgrade `@coral-xyz/anchor` beyond 0.29.x

### Checkpoint issues

- Check Redis: `redis-cli -a <password> GET indexer:checkpoint:src`
- Delete to restart: `DEL indexer:checkpoint:src indexer:checkpoint:dst`

### Price fetching issues

- Ensure `JUPITER_API_KEY` is set in `.env`
- Check price cache: `redis-cli -a <password> -n 1 KEYS "price:*"`
- Clear cache to refetch: `redis-cli -a <password> -n 1 FLUSHDB`
- Jupiter V3 API requires API key from [portal.jup.ag](https://portal.jup.ag)
