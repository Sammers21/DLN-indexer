export interface ParsedEvent {
  name: string;
  data: unknown;
}

export function extractCreatedOrderId(
  eventsList: ParsedEvent[],
): string | null {
  for (const event of eventsList) {
    if (event.name !== "CreatedOrderId") continue;
    const data = event.data as { orderId?: number[] };
    if (!data?.orderId || data.orderId.length !== 32) return null;
    return Buffer.from(data.orderId).toString("hex");
  }
  return null;
}

export function extractFulfilledOrderId(
  eventsList: ParsedEvent[],
): string | null {
  for (const event of eventsList) {
    if (event.name !== "Fulfilled") continue;
    const data = event.data as { orderId?: number[] };
    if (!data?.orderId || data.orderId.length !== 32) return null;
    return Buffer.from(data.orderId).toString("hex");
  }
  return null;
}
