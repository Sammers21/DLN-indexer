# DLN Order Indexer

A production-ready application that indexes DLN (deBridge Liquidity Network) order events on Solana, aggregates daily USD volumes, and visualizes the data in an analytical dashboard.

## Features

- **Event Indexing**: Indexes `OrderCreated` and `OrderFulfilled` events from DLN contracts on Solana
- **Bidirectional Indexing**: Prioritizes new transactions while also backfilling historical data
- **USD Volume Calculation**: Converts token amounts to USD using Jupiter Price API
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
│  ┌──────────────┐                    ┌──────────────┐           │
│  │  ClickHouse  │ ←─ Orders Data     │    Redis     │           │
│  │  (Analytics) │                    │ (Checkpoint) │           │
│  └──────────────┘                    └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Fastify REST API                       │   │
│  │  /api/orders  /api/volumes  /api/volumes/daily           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              React + Recharts Dashboard                   │   │
│  │  • Daily volume line charts                              │   │
│  │  • Order count bar charts                                │   │
│  │  • Date range filtering                                  │   │
│  │  • Paginated orders table                                │   │
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

| Component | Technology              | Rationale                               |
| --------- | ----------------------- | --------------------------------------- |
| Runtime   | Bun + TypeScript        | Fast startup, native TS support         |
| Database  | ClickHouse              | Column-oriented OLAP, fast aggregations |
| Cache     | Redis                   | Checkpoint state storage                |
| API       | Fastify                 | High performance, TypeScript support    |
| Dashboard | React + Vite + Recharts | Modern, fast, good charting             |
| Monorepo  | Turborepo               | Fast builds, smart caching              |
| Testing   | Mocha + Chai            | Mature, flexible test framework         |

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) and Docker Compose
- Solana RPC endpoint (default: public mainnet)

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
5. Store in ClickHouse

### 5. Start the API Server

```bash
bun run api
```

API available at http://localhost:3000

### 6. Start the Dashboard

```bash
bun run dashboard
```

Dashboard available at http://localhost:5173

## Project Structure

```
dln-indexer/
├── apps/
│   ├── indexer/             # Solana transaction indexer
│   │   └── src/
│   │       ├── main.ts      # Main entry point
│   │       ├── indexer.ts   # Core indexing logic
│   │       ├── solana.ts    # Rate-limited Solana client
│   │       ├── price.ts     # Jupiter price fetching
│   │       ├── analytics/   # ClickHouse analytics
│   │       ├── checkpoint/  # Checkpoint interfaces
│   │       └── storage/     # Redis & ClickHouse implementations
│   ├── api/                 # Fastify REST API
│   │   └── src/
│   │       ├── main.ts      # API server
│   │       └── routes/      # API routes
│   └── dashboard/           # React + Vite dashboard
│       └── src/
│           └── App.tsx      # Dashboard UI
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

### Health Check

```
GET /health
```

### Orders

```
GET /api/orders?page=1&limit=50&event_type=created&start_date=2024-01-01&end_date=2024-12-31
```

### Volumes

```
GET /api/volumes?start_date=2024-01-01&end_date=2024-12-31
GET /api/volumes/daily
GET /api/volumes/summary
```

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

- **Jupiter Price API**: Real-time prices for Solana tokens
- **OrderCreated**: USD value calculated from `give` token amount
- **OrderFulfilled**: USD value set to -1 (not calculated)
- **Stablecoin handling**: USDC/USDT treated as $1.00

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

## Assumptions

1. **Price Accuracy**: Uses spot price at indexing time, not historical prices at transaction time
2. **Token Decimals**: Default to 6 decimals for unknown tokens (common for stablecoins)
3. **Solana Chain ID**: `7565164` (0x736F6C = "sol")
4. **RPC Rate Limits**: Built-in rate limiter (bottleneck) to respect RPC limits

## Running Tests

```bash
bun test        # Watch mode
bun test:run    # Single run
```

## Development Commands

```bash
# Install all dependencies
bun install

# Run all apps in dev mode
bun run dev

# Run specific app
bun run indexer    # Run indexer
bun run api        # Run API server
bun run dashboard  # Run dashboard dev server

# Build all packages
bun run build

# Run all tests
bun run test
```

## Future Improvements

- [ ] Historical price backfill using CoinGecko API
- [ ] GraphQL API for flexible queries
- [ ] Kubernetes deployment manifests
- [ ] Prometheus metrics and Grafana dashboards
- [ ] Multi-chain support (EVM orders)
- [ ] Order lifecycle tracking (created → fulfilled → unlocked)
- [ ] Calculate USD value for OrderFulfilled from stored OrderCreated data

## License

MIT
