import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import type { Analytics, Order } from "@dln/shared";
import type {
  CheckpointStore,
  Checkpoint,
  ProgramType,
} from "../src/checkpoint";
import type { SolanaClient } from "../src/solana";
import { Indexer } from "../src/indexer";

const originalFetch = globalThis.fetch;

function makeSigInfo(
  signature: string,
  blockTime: number,
  err: unknown = null,
): ConfirmedSignatureInfo {
  return {
    signature,
    blockTime,
    err,
    memo: null,
    slot: 0,
    confirmationStatus: "confirmed",
  } as ConfirmedSignatureInfo;
}

function createMockStore(existing?: Checkpoint): CheckpointStore & {
  saved: Array<{ program: ProgramType; checkpoint: Checkpoint }>;
} {
  const saved: Array<{ program: ProgramType; checkpoint: Checkpoint }> = [];
  return {
    saved,
    getCheckpoint: async () => existing ?? null,
    setCheckpoint: async (program, checkpoint) => {
      saved.push({ program, checkpoint });
    },
    close: async () => {},
  };
}

function createMockAnalytics(): Analytics & { inserted: Order[] } {
  const inserted: Order[] = [];
  return {
    inserted,
    insertOrders: async (orders) => {
      inserted.push(...orders);
    },
    getOrderCount: async () => 0,
    close: async () => {},
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Indexer processing", () => {
  describe("processBatch with transactions", () => {
    it("skips when transaction is not found", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getTransactions: async () => [null],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        processBatch: (
          sigs: ConfirmedSignatureInfo[],
          dir: "forward" | "backward",
        ) => Promise<void>;
        lastCheckpointSaveTime: number;
        running: boolean;
      };
      internal.lastCheckpointSaveTime = Date.now();
      internal.running = true;

      await internal.processBatch([makeSigInfo("sig-1", 1000)], "forward");

      // Checkpoint should be updated
      const cp = indexer.getCheckpoint();
      expect(cp).to.not.equal(null);
      expect(cp!.to.signature).to.equal("sig-1");
      // No orders inserted
      expect(analytics.inserted).to.have.length(0);
    });

    it("processes transaction with no log messages", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getTransactions: async () => [{ meta: { logMessages: null } }],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        processBatch: (
          sigs: ConfirmedSignatureInfo[],
          dir: "forward" | "backward",
        ) => Promise<void>;
        lastCheckpointSaveTime: number;
        running: boolean;
      };
      internal.lastCheckpointSaveTime = Date.now();
      internal.running = true;

      await internal.processBatch([makeSigInfo("sig-2", 2000)], "forward");

      expect(analytics.inserted).to.have.length(0);
    });

    it("processes transaction with empty log messages", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getTransactions: async () => [{ meta: { logMessages: [] } }],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        processBatch: (
          sigs: ConfirmedSignatureInfo[],
          dir: "forward" | "backward",
        ) => Promise<void>;
        lastCheckpointSaveTime: number;
        running: boolean;
      };
      internal.lastCheckpointSaveTime = Date.now();
      internal.running = true;

      await internal.processBatch([makeSigInfo("sig-3", 3000)], "forward");

      expect(analytics.inserted).to.have.length(0);
    });

    it("handles parse errors gracefully", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getTransactions: async () => [
          {
            meta: {
              logMessages: [
                "Program src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4 invoke [1]",
                "Program log: invalid data that will cause parse error",
                "Program src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4 success",
              ],
            },
          },
        ],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        processBatch: (
          sigs: ConfirmedSignatureInfo[],
          dir: "forward" | "backward",
        ) => Promise<void>;
        lastCheckpointSaveTime: number;
      };
      internal.lastCheckpointSaveTime = Date.now();

      // Should not throw
      await internal.processBatch([makeSigInfo("sig-4", 4000)], "forward");

      expect(analytics.inserted).to.have.length(0);
    });
  });

  describe("processTransaction", () => {
    it("returns null when meta is missing", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const indexer = new Indexer(
        {} as unknown as SolanaClient,
        store,
        analytics,
        "OrderCreated",
      );
      const internal = indexer as unknown as {
        processTransaction: (
          tx: unknown,
          sigInfo: ConfirmedSignatureInfo,
        ) => Promise<Order | null>;
      };

      const result = await internal.processTransaction(
        { meta: null },
        makeSigInfo("sig-5", 5000),
      );
      expect(result).to.equal(null);
    });

    it("returns null when logMessages is undefined", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const indexer = new Indexer(
        {} as unknown as SolanaClient,
        store,
        analytics,
        "OrderFulfilled",
      );
      const internal = indexer as unknown as {
        processTransaction: (
          tx: unknown,
          sigInfo: ConfirmedSignatureInfo,
        ) => Promise<Order | null>;
      };

      const result = await internal.processTransaction(
        { meta: {} },
        makeSigInfo("sig-6", 6000),
      );
      expect(result).to.equal(null);
    });
  });

  describe("getForwardSignatures", () => {
    it("returns reversed batch when no checkpoint exists", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const sigs = [
        makeSigInfo("sig-c", 3000),
        makeSigInfo("sig-b", 2000),
        makeSigInfo("sig-a", 1000),
      ];
      const mockSolana = {
        getSignaturesForAddress: async () => sigs,
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        getForwardSignatures: () => Promise<ConfirmedSignatureInfo[]>;
      };

      const result = await internal.getForwardSignatures();
      // Should be reversed (oldest first)
      expect(result[0].signature).to.equal("sig-a");
      expect(result[1].signature).to.equal("sig-b");
      expect(result[2].signature).to.equal("sig-c");
    });

    it("returns signatures after checkpoint (newest first, then reversed)", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getSignaturesForAddress: async () => [
          makeSigInfo("sig-d", 4000),
          makeSigInfo("sig-c", 3000),
          makeSigInfo("sig-b", 2000), // this is the checkpoint
        ],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      // Set checkpoint manually
      const internal = indexer as unknown as {
        checkpoint: Checkpoint | null;
        getForwardSignatures: () => Promise<ConfirmedSignatureInfo[]>;
      };
      internal.checkpoint = {
        from: { signature: "sig-a", blockTime: 1000 },
        to: { signature: "sig-b", blockTime: 2000 },
      };

      const result = await internal.getForwardSignatures();
      // sig-d and sig-c are after checkpoint, reversed to oldest first
      expect(result).to.have.length(2);
      expect(result[0].signature).to.equal("sig-c");
      expect(result[1].signature).to.equal("sig-d");
    });

    it("returns empty array when no new signatures", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getSignaturesForAddress: async () => [
          makeSigInfo("sig-a", 1000), // this is the checkpoint
        ],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        checkpoint: Checkpoint | null;
        getForwardSignatures: () => Promise<ConfirmedSignatureInfo[]>;
      };
      internal.checkpoint = {
        from: { signature: "sig-a", blockTime: 1000 },
        to: { signature: "sig-a", blockTime: 1000 },
      };

      const result = await internal.getForwardSignatures();
      expect(result).to.have.length(0);
    });

    it("returns empty array when API returns empty", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const mockSolana = {
        getSignaturesForAddress: async () => [],
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");
      const internal = indexer as unknown as {
        checkpoint: Checkpoint | null;
        getForwardSignatures: () => Promise<ConfirmedSignatureInfo[]>;
      };
      internal.checkpoint = {
        from: { signature: "sig-a", blockTime: 1000 },
        to: { signature: "sig-a", blockTime: 1000 },
      };

      const result = await internal.getForwardSignatures();
      expect(result).to.have.length(0);
    });
  });

  describe("processOrderCreated", () => {
    it("returns null when no CreatedOrder event found", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const indexer = new Indexer(
        {} as unknown as SolanaClient,
        store,
        analytics,
        "OrderCreated",
      );
      const internal = indexer as unknown as {
        processOrderCreated: (
          events: Array<{ name: string; data: unknown }>,
          sigInfo: ConfirmedSignatureInfo,
          blockTime: number,
        ) => Promise<Order | null>;
      };

      const result = await internal.processOrderCreated(
        [{ name: "SomeOtherEvent", data: {} }],
        makeSigInfo("sig-x", 1000),
        1000,
      );
      expect(result).to.equal(null);
    });
  });

  describe("processOrderFulfilled", () => {
    it("returns null when no Fulfilled event found", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();
      const indexer = new Indexer(
        {} as unknown as SolanaClient,
        store,
        analytics,
        "OrderFulfilled",
      );
      const internal = indexer as unknown as {
        processOrderFulfilled: (
          events: Array<{ name: string; data: unknown }>,
          sigInfo: ConfirmedSignatureInfo,
          blockTime: number,
        ) => Promise<Order | null>;
      };

      const result = await internal.processOrderFulfilled(
        [{ name: "SomeOtherEvent", data: {} }],
        makeSigInfo("sig-y", 2000),
        2000,
      );
      expect(result).to.equal(null);
    });
  });

  describe("startIndexing", () => {
    it("loads checkpoint from store and processes forward signatures", async () => {
      const existingCheckpoint: Checkpoint = {
        from: { signature: "sig-old", blockTime: 1000 },
        to: { signature: "sig-latest", blockTime: 2000 },
      };
      const store = createMockStore(existingCheckpoint);
      const analytics = createMockAnalytics();

      let sigCallCount = 0;
      const mockSolana = {
        getSignaturesForAddress: async () => {
          sigCallCount++;
          // Return the checkpoint sig itself on first call (no new sigs)
          if (sigCallCount === 1) {
            return [makeSigInfo("sig-latest", 2000)];
          }
          // Backward direction also returns empty
          return [];
        },
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");

      // Run startIndexing but stop after first iteration
      const internal = indexer as unknown as {
        running: boolean;
        sleep: (ms: number) => Promise<void>;
      };

      // Override sleep to stop the indexer
      internal.sleep = async () => {
        indexer.stop();
      };

      await indexer.startIndexing();

      // Checkpoint should have been loaded from store
      const cp = indexer.getCheckpoint();
      expect(cp).to.not.equal(null);
      expect(cp!.from.signature).to.equal("sig-old");
      expect(cp!.to.signature).to.equal("sig-latest");
    });

    it("handles errors during indexing gracefully", async () => {
      const store = createMockStore();
      const analytics = createMockAnalytics();

      let callCount = 0;
      const mockSolana = {
        getSignaturesForAddress: async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error("RPC error");
          }
          return [];
        },
      } as unknown as SolanaClient;

      const indexer = new Indexer(mockSolana, store, analytics, "OrderCreated");

      const internal = indexer as unknown as {
        sleep: (ms: number) => Promise<void>;
      };
      internal.sleep = async () => {
        indexer.stop();
      };

      // Should not throw
      await indexer.startIndexing();
    });
  });
});
