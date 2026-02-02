-- Create database
CREATE DATABASE IF NOT EXISTS dln;

-- Orders table with ReplacingMergeTree for deduplication
CREATE TABLE IF NOT EXISTS dln.orders (
  order_id FixedString(64),           -- 32-byte hex
  event_type LowCardinality(String),  -- 'created' or 'fulfilled'
  tx_signature String,
  slot UInt64,
  block_time DateTime64(3),
  -- For created orders:
  give_chain_id Nullable(String),
  give_token_address Nullable(String),
  give_amount Nullable(String),       -- Store as string to handle large numbers
  take_chain_id Nullable(String),
  take_token_address Nullable(String),
  take_amount Nullable(String),
  maker Nullable(String),
  -- For fulfilled:
  taker Nullable(String),
  -- USD conversion:
  give_amount_usd Nullable(Float64),
  take_amount_usd Nullable(Float64),
  created_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(block_time)
ORDER BY (order_id, event_type)
PRIMARY KEY (order_id, event_type);

-- Materialized view for daily aggregations
CREATE MATERIALIZED VIEW IF NOT EXISTS dln.daily_volumes_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, event_type)
AS SELECT
  toDate(block_time) AS date,
  event_type,
  count() AS order_count,
  sum(give_amount_usd) AS volume_usd
FROM dln.orders
GROUP BY date, event_type;

-- Create index for faster queries by block_time
ALTER TABLE dln.orders ADD INDEX idx_block_time block_time TYPE minmax GRANULARITY 1;
