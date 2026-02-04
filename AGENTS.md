# DLN Indexer - Agent Guidelines

## ⚠️ Before Completing Work

**Only run these checks if the agent changed any source files as part of its work/iteration. If no source files were modified, do not run these commands.**

```bash
bun run test       # All tests must pass
bun format:check   # Code must be properly formatted (or run `bun format` to fix)
```

## Project Overview

Solana blockchain indexer for DLN (deBridge Liquidity Network) cross-chain orders. Turborepo monorepo with:

- **Indexer** (`apps/indexer`) - Fetches/parses blockchain transactions
- **API** (`apps/api`) - Hono API server
- **Dashboard** (`apps/dashboard`) - React UI
- **Shared** (`packages/shared`) - Common code

## Tech Stack

| Component | Technology                            |
| --------- | ------------------------------------- |
| Runtime   | **Bun** (use `bun`, not npm/yarn)     |
| Language  | TypeScript (ESM, `.js` in imports)    |
| Database  | ClickHouse                            |
| Cache     | Redis (db0: checkpoints, db1: prices) |
| Pricing   | Jupiter V3 API                        |
| Testing   | Mocha + Chai                          |

## Commands

```bash
bun install              # Install dependencies
bun run test             # Run all tests
bun format               # Format code
bun format:check         # Check formatting
bun run indexer          # Start indexer
bun run api              # Start API
bun run dashboard        # Start dashboard
cd infra && docker compose up -d  # Start infrastructure
```

## Key Files

- `apps/indexer/src/indexer.ts` - Core indexing logic
- `apps/indexer/src/solana.ts` - Rate-limited Solana RPC client
- `apps/indexer/src/price.ts` - Jupiter price fetching + Redis cache
- `apps/indexer/src/dln-api.ts` - DLN API for fulfilled order values
- `packages/shared/src/config.ts` - Environment configuration
- `packages/shared/src/idls/` - Anchor IDL definitions

## DLN Programs

- **Source**: `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4` - `CreatedOrder` events
- **Destination**: `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo` - `Fulfilled` events

## Environment Variables

Required in `.env`:

- `SOLANA_RPC_URL` - Solana RPC endpoint
- `CLICKHOUSE_HOST` - ClickHouse HTTP endpoint
- `REDIS_URL` - Redis connection string
- `JUPITER_API_KEY` - From portal.jup.ag

## Testing Guidelines

- Tests in `test/` directories with `.test.ts` suffix
- Use Mocha + Chai (not Bun's test runner)
- Tests must not require network/database access - use mocks
- Set env vars before imports if needed (e.g., `process.env.JUPITER_API_KEY = "test"`)

## Code Style

- `const` by default, `let` only when needed
- Explicit return types on exports
- Use Pino logger: `createLogger('module-name')`

## Troubleshooting

- **Anchor IDL errors**: Keep `@coral-xyz/anchor` at 0.29.x
- **Rate limiting**: Decrease `INDEXER_BATCH_SIZE` or `SOLANA_RPS`
- **Reset checkpoints**: `redis-cli DEL indexer:checkpoint:src indexer:checkpoint:dst`
