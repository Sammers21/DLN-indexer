export type OrderKind = "OrderCreated" | "OrderFulfilled";
export type OrderEventType = "created" | "fulfilled";
export type PricingStatus = "ok" | "error";

export interface Order {
    orderId: string;
    signature: string;
    time: number;
    usdValue: number | null;
    pricingStatus: PricingStatus;
    pricingError: string | null;
    kind: OrderKind;
}

export interface Analytics {
    insertOrders(orders: Order[]): Promise<void>;
    getOrderCount(kind: OrderKind): Promise<number>;
    close(): Promise<void>;
}

export interface DailyVolume {
    period: string;
    order_count: number;
    volume_usd: number;
}
