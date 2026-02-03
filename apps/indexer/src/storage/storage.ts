import { Order } from "../analytics";

/**
 * Interface for order storage implementations
 */
export interface OrderStorage {
    /**
     * Find an order by its ID
     */
    findOrderById(orderId: string): Promise<Order | null>;

    /**
     * Save an order (for caching/storage)
     */
    saveOrder(order: Order): Promise<void>;

    /**
     * Close the storage connection
     */
    close(): Promise<void>;
}
