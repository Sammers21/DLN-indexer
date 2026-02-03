export type OrderKind = "OrderCreated" | "OrderFulfilled";

export interface Order {
    orderId: string;
    signature: string;
    time: number;
    usdValue: number;
    kind: OrderKind;
}

export interface Analytics {
    insertOrders(orders: Order[]): Promise<void>;
    getOrderCount(kind: OrderKind): Promise<number>;
    close(): Promise<void>;
}

export type VolumeInterval = "day" | "hour" | "15min";

export interface VolumeData {
    period: string;
    event_type: string;
    order_count: number;
    volume_usd: number;
}
