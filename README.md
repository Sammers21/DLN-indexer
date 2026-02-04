# DLN Order Indexer

[![CI](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml/badge.svg)](https://github.com/Sammers21/DLN-indexer/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Sammers21/DLN-indexer/graph/badge.svg)](https://codecov.io/gh/Sammers21/DLN-indexer)

Indexes DLN (deBridge Liquidity Network) cross-chain order events on Solana, calculates USD volumes, and displays analytics in a dashboard.

## Quick Start

```bash
# Install
bun install

# Start infrastructure (ClickHouse + Redis)
cd infra && docker compose up -d && cd ..

# Configure (copy and edit .env)
cp .env.example .env

# Run
bun run indexer   # Start indexing
bun run api       # Start API (port 3000)
bun run dashboard # Start dashboard (port 5173)
```

## Architecture

```
Solana RPC → Indexer → ClickHouse → API → Dashboard
                ↓
              Redis (checkpoints + price cache)
```

- **Indexer**: Fetches transactions from DLN programs, parses events, enriches with USD prices, stores in ClickHouse
- **API**: Hono server exposing `/api/volume/:kind` and `/api/default_range` endpoints
- **Dashboard**: React + Recharts visualization of daily volumes and order counts

## External APIs & Dependencies

| Service                  | Purpose                                          | Notes                                                        |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------ |
| **Solana RPC**           | Fetch transactions                               | Rate-limited via bottleneck                                  |
| **Jupiter Price API V3** | Token USD prices                                 | Requires API key from [portal.jup.ag](https://portal.jup.ag) |
| **DLN API**              | Fulfilled order details                          | Used for cross-chain order pricing                           |
| **ClickHouse**           | Analytics storage                                | ReplacingMergeTree for deduplication                         |
| **Redis**                | Checkpoints (db0) + price cache (db1, 10min TTL) |                                                              |

## DLN Programs

| Program        | Address                                       | Events         |
| -------------- | --------------------------------------------- | -------------- |
| DlnSource      | `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4` | `CreatedOrder` |
| DlnDestination | `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo` | `Fulfilled`    |

## Key Design Decisions & Tradeoffs

### Bidirectional Indexing

Indexer expands both forward (new txs) and backward (history). Prioritizes new transactions; backfills during idle periods. Checkpoint stores `from` (oldest) and `to` (newest) signatures.

### Price Accuracy

Uses Jupiter **spot price at indexing time**, not historical price at transaction time. Jupiter V3 doesn't provide historical queries. Prices cached 10 minutes in Redis—orders indexed within the same window share prices.

**Tradeoff**: Faster/simpler vs. less accurate for historical data.

### Cross-Chain Fulfilled Orders

For orders where the take-side token is on an EVM chain (not Solana), USD value cannot be calculated (no EVM price oracle). These are stored with `pricing_status = 'error'` and `usd_value = null`.

**Tradeoff**: Solana-only pricing vs. full cross-chain support.

### Idempotent Inserts

ClickHouse ReplacingMergeTree handles duplicate inserts gracefully. Safe to restart indexer without data corruption.

### Token Decimals

Fetched on-demand from on-chain mint accounts. Hardcoded fallbacks for common tokens (SOL, USDC, USDT, BONK, JUP).

## Assumptions

1. **Solana Chain ID**: `7565164` (0x736F6C = "sol")
2. **Event parsing**: Uses Anchor's BorshCoder with DLN IDLs
3. **RPC limits**: Default 10 RPS, configurable via `SOLANA_RPS`
4. **Target**: Indexer monitors until 25,000+ orders of each type

## Environment Variables

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
CLICKHOUSE_HOST=http://localhost:8123
REDIS_URL=redis://localhost:6379
JUPITER_API_KEY=your-key-from-portal.jup.ag
```

## Commands

```bash
bun install          # Install dependencies
bun run test         # Run tests
bun format           # Format code
bun run indexer      # Start indexer
bun run api          # Start API
bun run dashboard    # Start dashboard
```

## Future Improvements

- [ ] Historical price backfill (Birdeye/Pyth historical feeds)
- [ ] EVM token pricing for cross-chain orders (CoinGecko/DefiLlama)
- [ ] Order lifecycle tracking (created → fulfilled → unlocked)

## License

MIT
