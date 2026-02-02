-- Create database
CREATE DATABASE IF NOT EXISTS dln;

-- Orders table with ReplacingMergeTree for deduplication
CREATE TABLE IF NOT EXISTS dln.orders (
  order_id String,
  tx_signature String,
  block_time DateTime,
  usd_value Float64,
  event_type LowCardinality(String),  -- 'created' or 'fulfilled'
  created_at DateTime DEFAULT now()
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
  sum(usd_value) AS volume_usd
FROM dln.orders
GROUP BY date, event_type;

-- Create index for faster queries by block_time
ALTER TABLE dln.orders ADD INDEX idx_block_time block_time TYPE minmax GRANULARITY 1;
