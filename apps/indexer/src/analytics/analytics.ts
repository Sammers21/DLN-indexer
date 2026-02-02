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
