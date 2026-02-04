-- Create database
CREATE DATABASE IF NOT EXISTS dln;

-- Orders table with ReplacingMergeTree for deduplication
CREATE TABLE IF NOT EXISTS dln.orders (
  order_id String,
  tx_signature String,
  block_time DateTime,
  usd_value Nullable(Float64),
  pricing_status LowCardinality(String) DEFAULT 'ok',
  pricing_error Nullable(String),
  event_type LowCardinality(String),  -- 'created' or 'fulfilled'
  created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMMDD(block_time)
ORDER BY (order_id, event_type)
PRIMARY KEY (order_id, event_type);

-- Daily volume queries run directly on the orders table with FINAL
-- to ensure correct deduplication via ReplacingMergeTree.
-- A SummingMergeTree MV was removed because it double-counts rows
-- when the indexer re-processes overlapping transactions on restart.

-- Create index for faster queries by block_time
ALTER TABLE dln.orders ADD INDEX idx_block_time block_time TYPE minmax GRANULARITY 1;
