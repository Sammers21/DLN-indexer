export type EventKind = "OrderCreated" | "OrderFulfilled";

export interface OrderCreatedEvent {
    signature: string;
    blockTime: number;
    giveChainId: string;
    giveToken: string;
    giveAmount: bigint;
    takeChainId: string;
    takeToken: string;
    takeAmount: bigint;
}

export interface OrderFulfilledEvent {
    signature: string;
    blockTime: number;
    orderId: string;
    taker: string;
}

export type AnalyticsEvent =
    | { kind: "OrderCreated"; data: OrderCreatedEvent }
    | { kind: "OrderFulfilled"; data: OrderFulfilledEvent };

export interface EventCount {
    kind: EventKind;
    count: number;
}

export interface Analytics {
    insertEvent(event: AnalyticsEvent): Promise<void>;
    getEventCount(kind: EventKind): Promise<number>;
    close(): Promise<void>;
}
