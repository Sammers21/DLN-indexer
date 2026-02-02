import { createClient, ClickHouseClient } from '@clickhouse/client';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type { Order, DailyVolume } from '../types.js';

const logger = createLogger('clickhouse');

let client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: config.clickhouse.host,
      database: config.clickhouse.database,
      username: config.clickhouse.username,
      password: config.clickhouse.password,
    });
    logger.info('ClickHouse client initialized');
  }
  return client;
}

export async function closeClickHouseClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    logger.info('ClickHouse client closed');
  }
}

export async function insertOrders(orders: Order[]): Promise<void> {
  if (orders.length === 0) return;
  const ch = getClickHouseClient();
  const rows = orders.map((order) => ({
    order_id: order.order_id,
    event_type: order.event_type,
    tx_signature: order.tx_signature,
    slot: order.slot,
    block_time: order.block_time.toISOString(),
    give_chain_id: order.give_chain_id || null,
    give_token_address: order.give_token_address || null,
    give_amount: order.give_amount?.toString() || null,
    take_chain_id: order.take_chain_id || null,
    take_token_address: order.take_token_address || null,
    take_amount: order.take_amount?.toString() || null,
    maker: order.maker || null,
    taker: order.taker || null,
    give_amount_usd: order.give_amount_usd || null,
    take_amount_usd: order.take_amount_usd || null,
  }));
  await ch.insert({
    table: 'orders',
    values: rows,
    format: 'JSONEachRow',
  });
  logger.debug({ count: orders.length }, 'Inserted orders');
}

export async function getOrders(params: {
  page?: number;
  limit?: number;
  eventType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ orders: Order[]; total: number }> {
  const ch = getClickHouseClient();
  const page = params.page || 1;
  const limit = params.limit || 50;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const queryParams: Record<string, string | number> = {};
  if (params.eventType) {
    conditions.push('event_type = {eventType:String}');
    queryParams.eventType = params.eventType;
  }
  if (params.startDate) {
    conditions.push('block_time >= {startDate:DateTime64(3)}');
    queryParams.startDate = params.startDate;
  }
  if (params.endDate) {
    conditions.push('block_time <= {endDate:DateTime64(3)}');
    queryParams.endDate = params.endDate;
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await ch.query({
    query: `SELECT count() as total FROM orders FINAL ${whereClause}`,
    query_params: queryParams,
    format: 'JSONEachRow',
  });
  const countData = await countResult.json<{ total: string }>();
  const countArray = countData as unknown as { total: string }[];
  const total = parseInt(countArray[0]?.total || '0', 10);
  const ordersResult = await ch.query({
    query: `
      SELECT * FROM orders FINAL
      ${whereClause}
      ORDER BY block_time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...queryParams, limit, offset },
    format: 'JSONEachRow',
  });
  const ordersData = await ordersResult.json<Order>();
  const ordersArray = ordersData as unknown as Order[];
  return { orders: ordersArray, total };
}

export async function getDailyVolumes(params: {
  startDate?: string;
  endDate?: string;
}): Promise<DailyVolume[]> {
  const ch = getClickHouseClient();
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};
  if (params.startDate) {
    conditions.push('date >= {startDate:Date}');
    queryParams.startDate = params.startDate;
  }
  if (params.endDate) {
    conditions.push('date <= {endDate:Date}');
    queryParams.endDate = params.endDate;
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await ch.query({
    query: `
      SELECT
        date,
        event_type,
        sum(order_count) as order_count,
        sum(volume_usd) as volume_usd
      FROM daily_volumes_mv FINAL
      ${whereClause}
      GROUP BY date, event_type
      ORDER BY date ASC
    `,
    query_params: queryParams,
    format: 'JSONEachRow',
  });
  const data = await result.json<DailyVolume>();
  return data as unknown as DailyVolume[];
}

export async function getVolumeSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<{
  total_created_volume_usd: number;
  total_fulfilled_volume_usd: number;
  total_created_count: number;
  total_fulfilled_count: number;
}> {
  const ch = getClickHouseClient();
  const conditions: string[] = [];
  const queryParams: Record<string, string> = {};
  if (params.startDate) {
    conditions.push('date >= {startDate:Date}');
    queryParams.startDate = params.startDate;
  }
  if (params.endDate) {
    conditions.push('date <= {endDate:Date}');
    queryParams.endDate = params.endDate;
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await ch.query({
    query: `
      SELECT
        sumIf(volume_usd, event_type = 'created') as total_created_volume_usd,
        sumIf(volume_usd, event_type = 'fulfilled') as total_fulfilled_volume_usd,
        sumIf(order_count, event_type = 'created') as total_created_count,
        sumIf(order_count, event_type = 'fulfilled') as total_fulfilled_count
      FROM daily_volumes_mv FINAL
      ${whereClause}
    `,
    query_params: queryParams,
    format: 'JSONEachRow',
  });
  type SummaryResult = {
    total_created_volume_usd: number;
    total_fulfilled_volume_usd: number;
    total_created_count: number;
    total_fulfilled_count: number;
  };
  const data = await result.json<SummaryResult>();
  const dataArray = data as unknown as SummaryResult[];
  return (
    dataArray[0] || {
      total_created_volume_usd: 0,
      total_fulfilled_volume_usd: 0,
      total_created_count: 0,
      total_fulfilled_count: 0,
    }
  );
}
