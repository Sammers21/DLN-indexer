export type OrderKind = "OrderCreated" | "OrderFulfilled";

export interface Order {
    orderId: string;
    signature: string;
    time: number;
    usdValue: number;
    kind: OrderKind;
}

export interface Analytics {
    insertOrder(order: Order): Promise<void>;
    getOrderCount(kind: OrderKind): Promise<number>;
    close(): Promise<void>;
}
