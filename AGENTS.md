# DLN Indexer - Agent Guidelines

This document provides context for AI coding agents working on this project.

## Project Overview

DLN Indexer is a **Solana blockchain indexer** that tracks DLN (deBridge Liquidity Network) cross-chain order events. It consists of three applications in a Turborepo monorepo:

1. **Indexer** - Fetches and parses blockchain transactions
2. **API** - REST API for querying indexed data
3. **Dashboard** - React visualization of volumes and orders

## Technology Stack

| Layer    | Technology       | Notes                                           |
| -------- | ---------------- | ----------------------------------------------- |
| Runtime  | **Bun**          | Use `bun` for all commands, not `npm` or `yarn` |
| Language | **TypeScript**   | ESM modules (`.js` extensions in imports)       |
| Database | **ClickHouse**   | Column-oriented OLAP database                   |
| Cache    | **Redis**        | Checkpoints and price caching                   |
| API      | **Fastify**      | v5.x with TypeScript                            |
| Frontend | **React + Vite** | With Recharts for charts                        |
| Testing  | **Mocha + Chai** | Test files in `test/` directories               |
| Monorepo | **Turborepo**    | Workspace management                            |

## Project Structure

```
dln-indexer/
├── apps/
│   ├── indexer/              # Blockchain indexer
│   │   ├── src/
│   │   │   ├── index.ts      # Entry point - orchestrates indexing
│   │   │   ├── fetcher.ts    # Solana RPC communication
│   │   │   └── parser.ts     # DLN event parsing (Borsh/Anchor)
│   │   └── test/
│   ├── api/                  # REST API server
│   │   ├── src/
│   │   │   ├── server.ts     # Fastify server setup
│   │   │   └── routes/       # API route handlers
│   │   └── test/
│   └── dashboard/            # React frontend
│       └── src/
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

- **DLN Source** (`src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4`) - Emits `CreatedOrder` events when users create cross-chain orders
- **DLN Destination** (`dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo`) - Emits `Fulfilled` events when orders are filled

### Event Parsing

- Uses Anchor's `BorshCoder` and `EventParser` to deserialize events from transaction logs
- IDLs are in `packages/shared/src/idls/` - these define the on-chain program structures
- Chain IDs and amounts are stored as byte arrays and need conversion (see `parser.ts`)

### Data Flow

```
Solana RPC → Fetcher → Parser → Price Enrichment → ClickHouse
                                      ↓
                              Redis (price cache)
```

### Checkpointing

- Indexer stores last processed signature in Redis
- On restart, continues from checkpoint (restart-safe)
- Key format: `indexer:checkpoint:src` or `indexer:checkpoint:dst`

## Development Commands

```bash
# Install dependencies
bun install

# Start infrastructure (ClickHouse + Redis)
cd infra && docker compose up -d

# Run apps
bun run indexer     # Start blockchain indexer
bun run api         # Start API server (port 3000)
bun run dashboard   # Start dashboard dev server (port 5173)

# Testing
bun run test        # Watch mode
bun run test:run    # Single run

# Type checking
bunx tsc --noEmit -p apps/indexer/tsconfig.json
bunx tsc --noEmit -p apps/api/tsconfig.json
bunx tsc --noEmit -p packages/shared/tsconfig.json
```

## Import Conventions

### From shared package

```typescript
import { config, createLogger, type Order } from "@dln/shared";
import { getClickHouseClient, insertOrders } from "@dln/shared";
import { DLN_SRC_IDL, DLN_DST_IDL } from "@dln/shared";
```

### Internal imports (use .js extension)

```typescript
import { parseTransaction } from "./parser.js";
import { fetchSignatures } from "./fetcher.js";
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
give_amount_usd Float64     -- USD value (enriched via Jupiter API)
```

## API Endpoints

| Endpoint                   | Description                |
| -------------------------- | -------------------------- |
| `GET /health`              | Health check               |
| `GET /api/orders`          | Paginated orders list      |
| `GET /api/orders/:orderId` | Single order by ID         |
| `GET /api/volumes`         | Volume data with summary   |
| `GET /api/volumes/daily`   | Daily volumes for charting |
| `GET /api/volumes/summary` | Aggregate statistics       |

## Environment Variables

Key variables (see `.env.example`):

- `SOLANA_RPC_URL` - Solana RPC endpoint (use paid provider for speed)
- `CLICKHOUSE_HOST` - ClickHouse HTTP endpoint
- `REDIS_URL` - Redis connection string
- `INDEXER_BATCH_SIZE` - Signatures per batch (lower = safer for rate limits)
- `INDEXER_DELAY_MS` - Delay between batches

## Common Tasks

### Adding a new API endpoint

1. Add route handler in `apps/api/src/routes/`
2. Register in `apps/api/src/server.ts`
3. Add types to `packages/shared/src/types.ts` if needed

### Adding a new service

1. Create in `packages/shared/src/services/`
2. Export from `packages/shared/src/services/index.ts`
3. Export from `packages/shared/src/index.ts`

### Modifying database schema

1. Update `infra/init-db.sql`
2. Run `docker compose down -v && docker compose up -d` to recreate

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
- Increase `INDEXER_DELAY_MS`
- Use a paid RPC provider (Helius, QuickNode)

### Type errors with ClickHouse responses

- Use `as unknown as Type[]` pattern for JSON responses
- ClickHouse client returns objects that need casting

### IDL parsing errors

- Anchor 0.29.0 is required (newer versions have incompatible IDL format)
- Don't upgrade `@coral-xyz/anchor` beyond 0.29.x
