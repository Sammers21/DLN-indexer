import { createLogger } from "@dln/shared";
import { Order } from "../analytics";
import { OrderStorage } from "./storage";

const logger = createLogger("composite-storage");

/**
 * Composite storage that tries each storage in order.
 * - For findOrderById: returns the first non-null result
 * - For saveOrder: saves to all storages
 */
export class CompositeOrderStorage implements OrderStorage {
    private readonly storages: OrderStorage[];
    constructor(storages: OrderStorage[]) {
        if (storages.length === 0) {
            throw new Error("CompositeOrderStorage requires at least one storage");
        }
        this.storages = storages;
        logger.info({ count: storages.length }, "Composite order storage initialized");
    }
    async findOrderById(orderId: string): Promise<Order | null> {
        for (let i = 0; i < this.storages.length; i++) {
            const storage = this.storages[i];
            try {
                const order = await storage.findOrderById(orderId);
                if (order !== null) {
                    logger.debug({ orderId, storageIndex: i }, "Order found in storage");
                    // If found in a later storage, cache it in earlier ones
                    for (let j = 0; j < i; j++) {
                        try {
                            await this.storages[j].saveOrder(order);
                        } catch (err) {
                            logger.warn({ err, orderId, storageIndex: j }, "Failed to cache order in earlier storage");
                        }
                    }
                    return order;
                }
            } catch (err) {
                logger.warn({ err, orderId, storageIndex: i }, "Error querying storage");
            }
        }
        logger.debug({ orderId }, "Order not found in any storage");
        return null;
    }
    async saveOrder(order: Order): Promise<void> {
        // Save to all storages (in parallel)
        const results = await Promise.allSettled(
            this.storages.map((storage) => storage.saveOrder(order))
        );
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === "rejected") {
                logger.warn({ err: result.reason, orderId: order.orderId, storageIndex: i }, "Failed to save order to storage");
            }
        }
    }
    async close(): Promise<void> {
        await Promise.all(this.storages.map((storage) => storage.close()));
        logger.info("Composite order storage closed");
    }
}
