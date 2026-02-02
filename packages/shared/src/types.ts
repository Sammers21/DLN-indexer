export type EventType = 'created' | 'fulfilled';

export interface Order {
  order_id: string;
  event_type: EventType;
  tx_signature: string;
  slot: bigint;
  block_time: Date;
  give_chain_id?: string;
  give_token_address?: string;
  give_amount?: bigint;
  take_chain_id?: string;
  take_token_address?: string;
  take_amount?: bigint;
  maker?: string;
  taker?: string;
  give_amount_usd?: number;
  take_amount_usd?: number;
}

export interface DailyVolume {
  date: string;
  event_type: EventType;
  order_count: number;
  volume_usd: number;
}

export interface IndexerCheckpoint {
  program: 'src' | 'dst';
  last_signature: string;
  last_slot: number;
  updated_at: string;
}

export interface CreatedOrderEvent {
  orderId: string;
  order: {
    makerOrderNonce: bigint;
    makerSrc: Uint8Array;
    give: {
      chainId: Uint8Array;
      tokenAddress: Uint8Array;
      amount: Uint8Array;
    };
    take: {
      chainId: Uint8Array;
      tokenAddress: Uint8Array;
      amount: Uint8Array;
    };
    receiverDst: Uint8Array;
    givePatchAuthoritySrc: Uint8Array;
    orderAuthorityAddressDst: Uint8Array;
    allowedTakerDst: Uint8Array | null;
    allowedCancelBeneficiarySrc: Uint8Array | null;
    externalCall: { externalCallShortcut: Uint8Array } | null;
  };
  fixFee: bigint;
  percentFee: bigint;
}

export interface FulfilledEvent {
  orderId: string;
  taker: string;
}

export interface OrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
}

export interface VolumesResponse {
  volumes: DailyVolume[];
  summary: {
    total_created_volume_usd: number;
    total_fulfilled_volume_usd: number;
    total_created_count: number;
    total_fulfilled_count: number;
  };
}

export interface TokenPrice {
  address: string;
  priceUsd: number;
  timestamp: number;
}
