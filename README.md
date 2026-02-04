# DLN Order Indexer

[![CI](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml/badge.svg)](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Sammers21/DLN-indexer/graph/badge.svg)](https://codecov.io/gh/Sammers21/DLN-indexer)

A production-ready application that indexes DLN (deBridge Liquidity Network) order events on Solana, aggregates daily USD volumes, and visualizes the data in an analytical dashboard.

## Features

- **Event Indexing**: Indexes `OrderCreated` and `OrderFulfilled` events from DLN contracts on Solana
- **Bidirectional Indexing**: Prioritizes new transactions while also backfilling historical data
- **USD Volume Calculation**: Converts token amounts to USD using Jupiter Price API V3
- **Price Caching**: Redis-based price cache with 10-minute TTL for efficient API usage
- **Restart Safety**: Interval-based checkpoint that tracks indexed range (from/to signatures)
- **Analytics Dashboard**: React-based dashboard with daily volume charts and date filtering
- **High-Performance Storage**: Uses ClickHouse for fast analytical queries

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Indexer Service                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐   │
│  │ Solana   │→ │ TX       │→ │ Event     │→ │ Price        │   │
│  │ RPC      │  │ Fetcher  │  │ Parser    │  │ Enrichment   │   │
│  └──────────┘  └──────────┘  └───────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       Storage Layer                              │
│  ┌──────────────┐       ┌──────────────────────────────────┐    │
│  │  ClickHouse  │       │           Redis                  │    │
│  │  (Analytics) │       │  db 0: Checkpoints               │    │
│  └──────────────┘       │  db 1: Price Cache (10min TTL)   │    │
│         ↑               └──────────────────────────────────┘    │
│    Orders Data                       ↑                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        API Service (Hono)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /api/default_range  /api/volume/:kind                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard (React)                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Daily charts, Date filtering                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Indexing Strategy

The indexer uses a **bidirectional approach** with interval-based checkpoints:

1. **Forward (Upwards)**: Fetches new transactions after the checkpoint's `to` boundary
2. **Backward**: When forward batch is small, also fetches older transactions before the `from` boundary
3. **Checkpoint Interval**: Stores both `from` (oldest indexed) and `to` (newest indexed) signatures

```
Time →
[────────────indexed range────────────]
from                                  to
↑ backward                   forward ↑
```

This ensures:

- New transactions are prioritized
- Historical data is backfilled during idle periods
- Full coverage of the transaction history over time

## Technology Stack

| Component | Technology           | Rationale                               |
| --------- | -------------------- | --------------------------------------- |
| Runtime   | Bun + TypeScript     | Fast startup, native TS support         |
| Database  | ClickHouse           | Column-oriented OLAP, fast aggregations |
| Cache     | Redis                | Checkpoints (db 0) + Price cache (db 1) |
| Pricing   | Jupiter Price API V3 | Real-time Solana token prices           |
| Web       | Hono + React + Vite  | API server + React dashboard            |
| Charts    | Recharts             | React-based charting library            |
| Monorepo  | Turborepo            | Fast builds, smart caching              |
| Testing   | Mocha + Chai         | Mature, flexible test framework         |

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) and Docker Compose
- Solana RPC endpoint (default: public mainnet)
- Jupiter API key from [portal.jup.ag](https://portal.jup.ag)

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repo-url>
cd dln-indexer
bun install
```

### 2. Start Infrastructure

```bash
cd infra
docker compose up -d
```

This starts:

- ClickHouse on port 8123 (HTTP) and 9000 (native)
- Redis on port 6379

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work for local development)
```

### 4. Run the Indexer

```bash
bun run indexer
```

The indexer will:

1. Connect to Solana RPC
2. Fetch transactions from DLN programs (forward and backward)
3. Parse `CreatedOrder` and `Fulfilled` events
4. Enrich `OrderCreated` with USD prices from Jupiter
5. Enrich `OrderFulfilled` via DLN API + Jupiter prices
6. Cache prices in Redis (10 min TTL)
7. Store in ClickHouse

### 5. Start the API

```bash
bun run api
```

API available at http://localhost:3000

### 6. Start the Dashboard (UI)

```bash
bun run dashboard
```

Dashboard available at http://localhost:5173 (Vite dev server)

For production:

```bash
cd apps/dashboard
bun run build
bun run preview
```

Dashboard preview available at http://localhost:4173

## Project Structure

```
dln-indexer/
├── apps/
│   ├── indexer/             # Solana transaction indexer
│   │   └── src/
│   │       ├── main.ts      # Main entry point
│   │       ├── indexer.ts   # Core indexing logic
│   │       ├── solana.ts    # Rate-limited Solana client
│   │       ├── price.ts     # Jupiter V3 price fetching + Redis cache
│   │       ├── dln-api.ts   # DLN API for OrderFulfilled USD values
│   │       ├── checkpoint/  # Checkpoint interfaces
│   │       └── storage/     # Redis checkpoint + price cache
│   ├── api/                 # Hono API server
│   │   └── src/
│   │       └── index.ts     # API routes
│   └── dashboard/           # React dashboard (Vite)
│       └── src/
│           └── client/      # React frontend
│               ├── App.tsx  # Dashboard UI
│               └── main.tsx # React entry point
├── packages/
│   └── shared/              # Shared code library
│       └── src/
│           ├── config.ts    # Configuration
│           ├── types.ts     # TypeScript types
│           ├── services/    # ClickHouse, Redis, Price service
│           ├── utils/       # Logger
│           └── idls/        # DLN Anchor IDLs
├── infra/                   # Infrastructure (Docker Compose)
│   ├── docker-compose.yml
│   └── init-db.sql
├── package.json             # Root workspace config
├── turbo.json               # Turborepo config
└── bunfig.toml              # Bun config
```

## API Endpoints

### Default Range

```
GET /api/default_range
```

### Daily Volume

```
GET /api/volume/:kind?from=2024-01-01&to=2024-12-31
```

Valid `:kind` values:

- `createOrder`
- `fulfilled`

## DLN Contract Addresses

| Contract       | Address                                       | Purpose           |
| -------------- | --------------------------------------------- | ----------------- |
| DlnSource      | `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4` | Order creation    |
| DlnDestination | `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo` | Order fulfillment |

## Key Technical Decisions

### 1. Event Parsing Approach

Using Anchor's `BorshCoder` and `EventParser` to deserialize events from transaction logs. This provides:

- Type-safe deserialization
- Support for complex nested structures
- Compatibility with Anchor IDL format

### 2. ClickHouse Schema Design

- **ReplacingMergeTree**: Handles duplicate inserts gracefully (idempotent)
- **Partitioning by month**: Efficient time-range queries
- **Materialized views**: Pre-aggregated daily volumes for fast dashboard queries

### 3. Price Conversion Strategy

- **Jupiter Price API V3**: Real-time prices for all Solana tokens (requires API key)
- **Redis Price Cache**: 10-minute TTL in db 1 to minimize API calls
- **OrderCreated**: USD value calculated from `give` token amount via Jupiter
- **OrderFulfilled**: USD value fetched via DLN API (cross-chain order details) + Jupiter
- **Token Support**: Any Solana SPL token that Jupiter supports

### 4. Restart Safety with Interval Checkpoints

- Checkpoint stored in Redis with `from` and `to` boundaries
- `from`: Oldest indexed signature (expands backward)
- `to`: Newest indexed signature (expands forward)
- Indexer resumes from both boundaries on restart
- ReplacingMergeTree handles duplicate inserts if overlap occurs

### 5. Monorepo with Turborepo

- **Shared package**: Common types, config, and services
- **Independent apps**: Indexer, API, and Dashboard can be developed/deployed independently
- **Fast builds**: Turborepo caches and parallelizes builds

## Assumptions & Known Limitations

1. **Price Accuracy**: Uses Jupiter spot price at indexing time, not historical prices at transaction time. Jupiter Price API V3 does not provide historical price queries. To improve accuracy, a historical price oracle (e.g. Birdeye Historical Price API, Pyth historical feeds, or a self-maintained OHLCV database) would be needed. Prices are cached in Redis with a 10-minute TTL, so orders indexed within the same window share the same price.
2. **Cross-chain Fulfilled Orders**: OrderFulfilled events where the take-side token is on an EVM chain (not Solana) are recorded with `pricing_status = 'error'` and `usd_value = null`. Supporting EVM token pricing would require integrating an EVM price oracle (e.g. CoinGecko, DefiLlama) and mapping EVM token addresses to price feeds.
3. **Token Decimals**: Fetched from on-chain mint accounts, with hardcoded fallbacks for common tokens (SOL, USDC, USDT, BONK, JUP).
4. **Solana Chain ID**: `7565164` (0x736F6C = "sol")
5. **RPC Rate Limits**: Built-in rate limiter (bottleneck) to respect RPC limits

## Running Tests

```bash
bun run test        # Run tests via Turbo
bun run test:run    # Single run via Turbo
```

## Development Commands

```bash
# Install all dependencies
bun install

# Run all apps in dev mode
bun run dev

# Run specific app
bun run indexer    # Run indexer
bun run api        # Run Hono API (port 3000)
bun run api:dev    # Run Hono API with watch mode
bun run dashboard  # Run dashboard (Vite dev server + API proxy)

# Build all packages
bun run build

# Run all tests
bun run test
```

## Future Improvements

- [ ] Historical price backfill using Birdeye or Pyth historical feeds
- [ ] EVM token pricing for cross-chain fulfilled orders (CoinGecko / DefiLlama)
- [ ] GraphQL API for flexible queries
- [ ] Kubernetes deployment manifests
- [ ] Order lifecycle tracking (created → fulfilled → unlocked)

## License

MIT
