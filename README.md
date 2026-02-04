# DLN Order Indexer

[![CI](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml/badge.svg)](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Sammers21/DLN-indexer/graph/badge.svg)](https://codecov.io/gh/Sammers21/DLN-indexer)

Indexes DLN (deBridge Liquidity Network) cross-chain order events on Solana, calculates USD volumes, and displays analytics in a dashboard.

---

## Table of Contents

1. [Setup & Run Instructions](#setup--run-instructions)
2. [Architecture Overview](#architecture-overview)
3. [Key Technical Decisions](#key-technical-decisions)
4. [Future Improvements](#future-improvements)

---

## Setup & Run Instructions

### Prerequisites

- **Bun** v1.0+ ([install](https://bun.sh))
- **Docker** & Docker Compose (for ClickHouse + Redis)
- **Jupiter API Key** from [portal.jup.ag](https://portal.jup.ag)
- **Solana RPC URL** (public or private endpoint)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Sammers21/DLN-indexer.git
cd DLN-indexer

# 2. Install dependencies
bun install

# 3. Start infrastructure (ClickHouse + Redis)
cd infra && docker compose up -d && cd ..

# 4. Configure environment variables
cp .env.example .env
# Edit .env with your values (see Environment Variables below)
```

### Environment Variables

Create a `.env` file in the project root:

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Your Solana RPC endpoint
CLICKHOUSE_HOST=http://localhost:8123               # ClickHouse HTTP endpoint
REDIS_URL=redis://localhost:6379                    # Redis connection string
JUPITER_API_KEY=your-key-from-portal.jup.ag         # Required for token pricing
```

### Running the Application

```bash
# Start the indexer (fetches and processes blockchain data)
bun run indexer

# Start the API server (port 3000)
bun run api

# Start the dashboard (port 5173)
bun run dashboard
```

Open [http://localhost:5173](http://localhost:5173) in your browser to view the dashboard.

### Useful Commands

```bash
bun install          # Install dependencies
bun run test         # Run all tests
bun format           # Format code
bun format:check     # Check code formatting
```

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SOLANA BLOCKCHAIN                              │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │         DlnSource Program       │  │      DlnDestination Program     │   │
│  │  src5qyZHqTqec...MPHr4          │  │  dst5MGcFPoBeR...SAbsLbNo       │   │
│  │  → CreatedOrder events          │  │  → Fulfilled events             │   │
│  └─────────────────────────────────┘  └─────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ getSignaturesForAddress
                               │ getTransactions (batched)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 INDEXER                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │  Solana RPC    │  │    Parser      │  │        Price Enrichment        │ │
│  │  (rate-limited)│→ │ (Own low-level │→ │  Jupiter API + DLN API         │ │
│  │                │  │  Borsh parser) │  │                                │ │
│  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │
│           │                                           │                     │
│           │              BIDIRECTIONAL                │                     │
│           │         ←── INDEXING ──→                  │                     │
│           │         (forward + backward)              │                     │
└───────────┼───────────────────────────────────────────┼─────────────────────┘
            │                                           │
            ▼                                           ▼
┌─────────────────────────┐                 ┌─────────────────────────────────┐
│         REDIS           │                 │          CLICKHOUSE             │
│  db0: Checkpoints       │                 │  dln.orders table               │
│  db1: Price cache (TTL) │                 │  event_type: created/fulfilled  │
└─────────────────────────┘                 └─────────────────────────────────┘
                                                          │
                                                          ▼
                                            ┌─────────────────────────────────┐
                                            │           HONO API              │
                                            │  /api/volume/:kind              │
                                            │  /api/default_range             │
                                            └─────────────────────────────────┘
                                                          │
                                                          ▼
                                            ┌─────────────────────────────────┐
                                            │      REACT DASHBOARD            │
                                            │  Daily volume charts            │
                                            │  Order count visualization      │
                                            └─────────────────────────────────┘
```

Parser note: the indexer uses an in-house low-level parser that manually decodes DLN event payloads with Borsh primitives (no Anchor `EventParser`/IDL runtime in the indexer path).

### Components

| Component     | Technology              | Description                                                                                     |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| **Indexer**   | TypeScript + Bun        | Fetches transactions, parses DLN events with a low-level Borsh parser, enriches with USD prices |
| **API**       | Hono                    | REST API serving aggregated volume data                                                         |
| **Dashboard** | React + Vite + Recharts | Interactive visualization of daily volumes and order counts                                     |
| **Storage**   | ClickHouse              | Analytics-optimized database with ReplacingMergeTree for deduplication                          |
| **Cache**     | Redis                   | Stores indexer checkpoints (db0) and price cache with 10min TTL (db1)                           |

### DLN Programs Indexed

| Program        | Address                                       | Events         |
| -------------- | --------------------------------------------- | -------------- |
| DlnSource      | `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4` | `CreatedOrder` |
| DlnDestination | `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo` | `Fulfilled`    |

---

## Key Technical Decisions

### 1. Bidirectional Indexing Strategy

The indexer uses a **bidirectional expansion** approach to efficiently index both historical and real-time transactions:

```
                    CHECKPOINT
                  [from ← → to]
                       │
    ┌──────────────────┴──────────────────┐
    │                                     │
    ▼                                     ▼
BACKWARD                              FORWARD
(historical)                          (new txs)
    │                                     │
    │  Lower priority                      │  Higher priority
    │  Backfills during                    │  Processes immediately
    │  idle periods                        │  to stay up-to-date
    ▼                                     ▼
```

- **Forward expansion**: Prioritized to keep the index up-to-date with new transactions
- **Backward expansion**: Fills in historical data during idle periods
- **Checkpoint persistence**: Redis stores `from` (oldest processed) and `to` (newest processed) signatures

### 2. Solana RPC Calls Used

We use three primary Solana RPC methods for indexing:

| RPC Method                | Purpose                                                 | Rate Limiting               |
| ------------------------- | ------------------------------------------------------- | --------------------------- |
| `getSignaturesForAddress` | Fetches transaction signatures for DLN program accounts | Bottleneck (default 10 RPS) |
| `getTransactions`         | Retrieves full transaction data in batches              | Batched to reduce calls     |
| `getAccountInfo`          | Fetches token mint accounts to retrieve decimal count   | On-demand per unique token  |

The RPC client is wrapped with **Bottleneck** for rate limiting to avoid hitting endpoint limits.

### 3. Token Price Resolution with Jupiter V3 API

For USD value calculation, we use the **Jupiter Price API V3**:

```
Order Token Mint → Jupiter V3 API → USD Price → Calculate Value
                         │
                         ▼
                  Redis Cache (db1)
                  TTL: 10 minutes
```

- **Why Jupiter**: Most comprehensive Solana token price coverage
- **Caching**: Prices cached in Redis for 10 minutes to reduce API calls
- **Limitation**: Jupiter provides **spot prices only**, not historical prices. Orders indexed later may have different prices than at transaction time.

### 4. DLN API for Fulfilled Order Information

For `Fulfilled` events, the take-side token may be on a non-Solana chain (e.g., Ethereum, Arbitrum). We query the **DLN API** to resolve order details:

```
Fulfilled Event (order_id) → DLN API → Take Token Details → Price Calculation
```

- **Endpoint**: `https://api.dln.trade/v1.0/dln/order?orderIdStr={orderId}`
- **Use case**: Retrieves the take token address and chain for cross-chain orders

### 5. Idempotent Data Storage

ClickHouse uses **ReplacingMergeTree** engine which handles duplicate inserts gracefully:

- Orders are keyed by transaction signature
- Re-indexing the same transactions won't create duplicates
- Safe to restart the indexer at any point

---

## Future Improvements

With more time, the following enhancements could be implemented:

### Infrastructure & Deployment

- [ ] **Helm Charts for Kubernetes**: Create production-ready Helm charts for deploying the full stack (indexer, API, dashboard, ClickHouse, Redis) to Kubernetes clusters
- [ ] **Horizontal scaling**: Support for multiple indexer instances with distributed checkpointing

### Pricing Improvements

- [ ] **Historical token price API integration**: Integrate with services like [Birdeye](https://birdeye.so), [Pyth](https://pyth.network), or [CoinGecko](https://coingecko.com) to fetch historical prices at transaction time, improving accuracy for backfilled data
- [ ] **Export/implement custom price oracle**: Build an internal historical price database by continuously recording Jupiter prices, enabling accurate historical lookups

---
